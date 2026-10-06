import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ParamValue } from '../config.js'
import { loadQueries } from '../queries/load.js'
import { BUILT_IN_PANELS, CHART_GROUPS } from '../runtime/catalog.js'
import { columnProps } from '../runtime/convert.js'
import type { ResolvedConfig, Workspace } from '../workspace.js'
import { analyzeDashboard, literal, parseSource, walk } from './analyze.js'
import { defaultParams } from './check.js'
import {
  discoverDashboards,
  type QueryRun,
  type RunOptions,
  runQueryIn,
  VALID_ID,
} from './dashboards.js'
import { OpsError } from './errors.js'
import { describeLayout } from './layout.js'

const ENTRY_NAMES = ['index.tsx', 'index.jsx']

type Node = { type: string; [key: string]: unknown }

/** What `defineChart({ … })` says about itself, read without running it. */
export interface ChartSpec {
  name: string
  /** Props that name a result column — `check` verifies them. */
  columns: string[]
  sample?: { query: string; props: Record<string, unknown> }
}

export interface ChartSummary extends ChartSpec {
  id: string
  file: string
  /** Dashboards that import it. */
  usedBy: string[]
  /** Names of the queries in the chart's own `.sql` files. */
  queries: string[]
}

export function discoverCharts(root: string, dir: string): { id: string; file: string }[] {
  const base = join(root, dir)
  if (!existsSync(base)) return []
  const found: { id: string; file: string }[] = []
  for (const entry of readdirSync(base).sort()) {
    const path = join(base, entry)
    if (!VALID_ID.test(entry) || !statSync(path).isDirectory()) continue
    const file = ENTRY_NAMES.map((name) => join(path, name)).find((f) => existsSync(f))
    if (file) found.push({ id: entry, file })
  }
  return found
}

function chartDir(config: ResolvedConfig, id: string): string {
  if (!VALID_ID.test(id)) throw new OpsError(`"${id}" is not a chart id`)
  const dir = join(config.root, config.chartsDir, id)
  if (!existsSync(dir)) throw new OpsError(`no chart "${id}" under ${config.chartsDir}/`, 404)
  return dir
}

export function readChartSpec(code: string, fallbackName: string): ChartSpec {
  let found: Record<string, unknown> | undefined
  walk(parseSource(code), (node) => {
    if (found || node.type !== 'CallExpression') return
    const callee = node.callee as Node
    if (callee.type !== 'Identifier' || callee.name !== 'defineChart') return
    const value = literal((node.arguments as Node[])[0] as never)
    if (value && typeof value === 'object') found = value as Record<string, unknown>
  })
  const spec: ChartSpec = {
    name: typeof found?.name === 'string' ? found.name : fallbackName,
    columns: Array.isArray(found?.columns)
      ? (found.columns as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
  }
  const sample = found?.sample as { query?: unknown; props?: unknown } | undefined
  if (sample && typeof sample.query === 'string') {
    spec.sample = {
      query: sample.query,
      props:
        sample.props && typeof sample.props === 'object'
          ? (sample.props as Record<string, unknown>)
          : {},
    }
  }
  return spec
}

/**
 * The custom charts a dashboard imports, by the local name it uses them under.
 * Only default imports of a folder under `charts/` count: that is what
 * `defineChart` produces and what `check` can follow.
 */
export function chartImports(
  config: ResolvedConfig,
  dashboardFile: string,
  code: string,
): Map<string, { id: string; spec: ChartSpec }> {
  const out = new Map<string, { id: string; spec: ChartSpec }>()
  const base = join(config.root, config.chartsDir) + sep
  let ast: Node
  try {
    ast = parseSource(code) as Node
  } catch {
    return out
  }
  for (const statement of (ast.program as { body: Node[] }).body) {
    if (statement.type !== 'ImportDeclaration') continue
    const source = (statement.source as { value: string }).value
    if (!source.startsWith('.')) continue
    const target = resolve(dirname(real(dashboardFile)), source)
    if (!(target + sep).startsWith(base)) continue
    const id = relative(base, target).split(sep)[0]
    if (!id || !VALID_ID.test(id)) continue
    const entry = discoverCharts(config.root, config.chartsDir).find((c) => c.id === id)
    if (!entry) continue
    for (const specifier of statement.specifiers as Node[]) {
      if (specifier.type !== 'ImportDefaultSpecifier') continue
      const local = (specifier.local as { name: string }).name
      out.set(local, { id, spec: readChartSpec(readFileSync(entry.file, 'utf8'), id) })
    }
  }
  return out
}

function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export function listCharts(config: ResolvedConfig): ChartSummary[] {
  const dashboards = discoverDashboards(config.root, config.dashboardsDir).map((d) => ({
    id: d.id,
    imports: [...chartImports(config, d.file, readFileSync(d.file, 'utf8')).values()].map(
      (c) => c.id,
    ),
  }))
  return discoverCharts(config.root, config.chartsDir).map(({ id, file }) => {
    let queries: string[] = []
    try {
      queries = [...loadQueries(join(config.root, config.chartsDir, id), config.root).keys()]
    } catch {
      // a broken sample is reported when the preview runs it
    }
    return {
      id,
      file: relative(config.root, file),
      ...readChartSpec(readFileSync(file, 'utf8'), id),
      usedBy: dashboards.filter((d) => d.imports.includes(id)).map((d) => d.id),
      queries,
    }
  })
}

/** A chart's sample query, by name, from its own folder — the browser still never sends SQL. */
export async function runChartQuery(
  workspace: Workspace,
  id: string,
  name: string,
  params: Record<string, ParamValue> = {},
  options: RunOptions = {},
): Promise<QueryRun> {
  const queries = loadQueries(chartDir(workspace.config, id), workspace.config.root)
  return runQueryIn(workspace, `chart:${id}`, queries, name, params, options)
}

export interface ChartUse {
  dashboard: string
  title: string
}

/** A panel as one dashboard uses it, with what it takes to draw it outside that dashboard. */
export interface ChartExample extends ChartUse {
  props: Record<string, unknown>
  params: Record<string, ParamValue>
  meta: { locale?: string; currency?: string }
}

export interface CatalogEntry {
  name: string
  kind: 'built-in' | 'custom'
  /** Built-in: the catalog group. Custom: none. */
  group?: string
  /** Props that name a result column. */
  columns: string[]
  usedBy: ChartUse[]
  /** A real use to preview, when a dashboard has one whose props are all literal. */
  example?: ChartExample
  /** Custom only. */
  id?: string
  file?: string
  sample?: ChartSpec['sample']
  queries?: string[]
}

/**
 * Every chart this workspace can use — the built-in panels and the custom
 * ones under `charts/` — with where each is used. The Charts page shows it,
 * `open-dashboard charts` prints it, so neither a person nor an agent builds a
 * chart that already exists.
 */
export async function chartCatalog(
  workspace: Workspace,
  now = new Date(),
): Promise<CatalogEntry[]> {
  const config = workspace.config
  const uses = new Map<string, ChartUse[]>()
  const examples = new Map<string, ChartExample>()
  for (const { id, file } of discoverDashboards(config.root, config.dashboardsDir)) {
    const code = readFileSync(file, 'utf8')
    const imported = chartImports(config, file, code)
    const analysis = analyzeDashboard(
      code,
      new Map([...imported].map(([name, chart]) => [name, chart.spec.columns])),
    )
    let layout: ReturnType<typeof describeLayout> | undefined
    try {
      layout = describeLayout(code)
    } catch {
      // a dashboard with a syntax error still counts its uses, it just has no examples
    }
    let params: Record<string, ParamValue> | undefined
    for (const panel of analysis.panels) {
      if (!panel.title) continue
      const name = imported.get(panel.component)?.id ?? panel.component
      const list = uses.get(name) ?? []
      list.push({ dashboard: id, title: panel.title })
      uses.set(name, list)
      // Text draws its children, which a props-only example cannot carry.
      if (examples.has(name) || !layout || name === 'Text') continue
      const found = layout.panels.find((p) => p.title === panel.title && p.locked.length === 0)
      if (!found) continue
      params ??= await defaultParams(workspace, id, analysis.filters, [], file, now)
      const meta: ChartExample['meta'] = {}
      if (typeof analysis.meta.locale === 'string') meta.locale = analysis.meta.locale
      if (typeof analysis.meta.currency === 'string') meta.currency = analysis.meta.currency
      examples.set(name, { dashboard: id, title: panel.title, props: found.props, params, meta })
    }
  }

  const groupOf = new Map(CHART_GROUPS.flatMap((g) => g.types.map((type) => [type, g.label])))
  const builtIn: CatalogEntry[] = BUILT_IN_PANELS.map((name) => {
    const entry: CatalogEntry = {
      name,
      kind: 'built-in',
      group: groupOf.get(name) ?? 'Basics',
      columns: [...columnProps(name)],
      usedBy: uses.get(name) ?? [],
    }
    const example = examples.get(name)
    if (example) entry.example = example
    return entry
  })
  const custom: CatalogEntry[] = listCharts(config).map((chart) => {
    const entry: CatalogEntry = {
      name: chart.name,
      kind: 'custom',
      id: chart.id,
      file: chart.file,
      columns: chart.columns,
      usedBy: uses.get(chart.id) ?? [],
      queries: chart.queries,
    }
    if (chart.sample) entry.sample = chart.sample
    return entry
  })
  return [...custom, ...builtIn]
}
