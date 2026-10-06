import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ParamValue, QueryResult } from '../config.js'
import { tableParams } from '../datasource/json-tables.js'
import { referencedParams } from '../datasource/params.js'
import { loadQueries, type NamedQuery } from '../queries/load.js'
import type { ResolvedConfig, Workspace } from '../workspace.js'
import { analyzeDashboard } from './analyze.js'
import { chartImports } from './charts.js'
import { combineResults } from './combine.js'
import { OpsError } from './errors.js'
import { cacheKey, parseDuration } from './query-cache.js'

const ENTRY_NAMES = ['index.tsx', 'index.jsx']
export const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export interface DashboardEntry {
  id: string
  file: string
}

export interface DashboardSummary {
  id: string
  title: string
  description?: string
  queries: number
  panels: number
  /** Datasources its queries read, a query without `-- source:` counting as the default. */
  sources: string[]
  /** `meta.refresh`, when the dashboard sets a default auto-refresh. */
  refresh?: string
  /** `meta.theme`, when the dashboard picks one. */
  theme?: string
  file: string
}

export function discoverDashboards(root: string, dir: string): DashboardEntry[] {
  const base = join(root, dir)
  if (!existsSync(base)) return []
  const found: DashboardEntry[] = []
  for (const entry of readdirSync(base).sort()) {
    const path = join(base, entry)
    if (!VALID_ID.test(entry) || !statSync(path).isDirectory()) continue
    const file = ENTRY_NAMES.map((name) => join(path, name)).find((candidate) =>
      existsSync(candidate),
    )
    if (file) found.push({ id: entry, file })
  }
  return found
}

export function dashboardDir(config: ResolvedConfig, id: string): string {
  if (!VALID_ID.test(id)) throw new OpsError(`"${id}" is not a dashboard id`)
  const dir = join(config.root, config.dashboardsDir, id)
  if (!existsSync(dir))
    throw new OpsError(`no dashboard "${id}" under ${config.dashboardsDir}/`, 404)
  return dir
}

export function dashboardFile(config: ResolvedConfig, id: string): string {
  const dir = dashboardDir(config, id)
  const file = ENTRY_NAMES.map((name) => join(dir, name)).find((candidate) => existsSync(candidate))
  if (!file) throw new OpsError(`dashboard "${id}" has no index.tsx`, 404)
  return file
}

export function listDashboards(config: ResolvedConfig): DashboardSummary[] {
  return discoverDashboards(config.root, config.dashboardsDir).map(({ id, file }) => {
    const code = readFileSync(file, 'utf8')
    const custom = new Map(
      [...chartImports(config, file, code)].map(([name, chart]) => [name, chart.spec.columns]),
    )
    const { meta, panels } = analyzeDashboard(code, custom)
    let queries = 0
    const sources = new Set<string>()
    try {
      const found = loadQueries(join(config.root, config.dashboardsDir, id), config.root)
      queries = found.size
      for (const query of found.values()) {
        const source = query.source || config.defaultSource
        if (source) sources.add(source)
      }
    } catch {
      // a broken query file is reported where it is used, not in the list
    }
    const summary: DashboardSummary = {
      id,
      title: typeof meta.title === 'string' ? meta.title : id,
      queries,
      panels: panels.length,
      sources: [...sources].sort(),
      file: relative(config.root, file),
    }
    if (typeof meta.description === 'string') summary.description = meta.description
    if (typeof meta.refresh === 'string') summary.refresh = meta.refresh
    if (typeof meta.theme === 'string') summary.theme = meta.theme
    return summary
  })
}

export function dashboardQueries(config: ResolvedConfig, id: string): Map<string, NamedQuery> {
  return loadQueries(dashboardDir(config, id), config.root)
}

export interface QueryRun {
  query: {
    name: string
    /** The datasource it ran on; 'combined' for a query with `-- uses:`. */
    source: string
    sql: string
    file: string
    line: number
    uses?: string[]
  }
  params: Record<string, ParamValue>
  result: QueryResult
  /** When the result was produced: earlier than now when it came from the cache. */
  ranAt: string
  cached: boolean
}

export interface RunOptions {
  /** Skip the cache and run now (the refresh button, `check`). The new result is cached. */
  fresh?: boolean
}

/** The parameters one query reads: in its SQL, and in the URLs or arguments of the API tables it names. */
export function queryParams(config: ResolvedConfig, query: NamedQuery): string[] {
  const own = referencedParams(query.sql)
  if (query.uses?.length) return own
  const name = query.source ?? config.defaultSource
  const source = name ? config.datasources[name] : undefined
  if (source?.type !== 'http' && source?.type !== 'mcp') return own
  return [...new Set([...own, ...tableParams(query.sql, source.tables)])]
}

/** Every parameter a query reads, its inputs' included. */
function readsOf(
  config: ResolvedConfig,
  queries: Map<string, NamedQuery>,
  name: string,
  seen = new Set<string>(),
): string[] {
  const query = queries.get(name)
  if (!query || seen.has(name)) return []
  seen.add(name)
  return [
    ...queryParams(config, query),
    ...(query.uses ?? []).flatMap((used) => readsOf(config, queries, used, seen)),
  ]
}

/**
 * The browser names a query; it never sends SQL. That is the whole security
 * model of the dev API: what runs is what is on disk under `dashboards/`.
 */
export async function runDashboardQuery(
  workspace: Workspace,
  id: string,
  name: string,
  params: Record<string, ParamValue> = {},
  options: RunOptions = {},
): Promise<QueryRun> {
  return runNamed(workspace, id, dashboardQueries(workspace.config, id), name, params, options, [])
}

/** A named query from any folder of `.sql` files — a custom chart's sample, say — run like a dashboard's. */
export async function runQueryIn(
  workspace: Workspace,
  scope: string,
  queries: Map<string, NamedQuery>,
  name: string,
  params: Record<string, ParamValue> = {},
  options: RunOptions = {},
): Promise<QueryRun> {
  return runNamed(workspace, scope, queries, name, params, options, [])
}

async function runNamed(
  workspace: Workspace,
  id: string,
  queries: Map<string, NamedQuery>,
  name: string,
  params: Record<string, ParamValue>,
  options: RunOptions,
  path: string[],
): Promise<QueryRun> {
  const query = queries.get(name)
  if (!query) {
    const known = [...queries.keys()]
    const from = path.length ? ` (used by "${path[path.length - 1]}")` : ''
    throw new OpsError(
      `dashboard "${id}" has no query "${name}"${from}${known.length ? ` — defined: ${known.join(', ')}` : ' — add it to a .sql file in the dashboard folder'}`,
      404,
    )
  }
  if (path.includes(name)) {
    throw new OpsError(`queries use each other in a loop: ${[...path, name].join(' → ')}`, 400)
  }

  const ttl =
    query.cache === undefined ? workspace.config.cacheMs : (parseDuration(query.cache) ?? NaN)
  if (Number.isNaN(ttl)) {
    throw new OpsError(
      `${query.file}:${query.line}: "-- cache: ${query.cache}" is not a duration — use 30s, 5m, 1h or off`,
      400,
    )
  }
  const key = cacheKey(id, name, params, readsOf(workspace.config, queries, name))
  if (!options.fresh && ttl > 0) {
    const hit = workspace.cache.get(key)
    if (hit) {
      const run = await hit.value
      return { ...run, params, cached: Date.now() - hit.storedAt > 50 }
    }
  }

  const pending = execute(workspace, id, queries, query, params, options, [...path, name])
  if (ttl > 0) workspace.cache.set(key, id, pending, ttl)
  return pending
}

async function execute(
  workspace: Workspace,
  id: string,
  queries: Map<string, NamedQuery>,
  query: NamedQuery,
  params: Record<string, ParamValue>,
  options: RunOptions,
  path: string[],
): Promise<QueryRun> {
  const ranAt = new Date().toISOString()
  const base = { name: query.name, sql: query.sql, file: query.file, line: query.line }
  if (query.uses) {
    const inputs = new Map<string, QueryResult>()
    // Inputs run side by side: they are usually on different databases.
    const runs = await Promise.all(
      query.uses.map((used) => runNamed(workspace, id, queries, used, params, options, path)),
    )
    for (const [i, used] of query.uses.entries()) inputs.set(used, (runs[i] as QueryRun).result)
    const result = await combineResults(query.sql, inputs, params, workspace.config.maxRows)
    return {
      query: { ...base, source: 'combined', uses: query.uses },
      params,
      result,
      ranAt,
      cached: false,
    }
  }
  const source = workspace.sourceName(query.source)
  const datasource = await workspace.source(source)
  const result = await datasource.query(query.sql, params, {
    maxRows: workspace.config.maxRows,
    timeoutMs: workspace.config.timeoutMs,
  })
  return { query: { ...base, source }, params, result, ranAt, cached: false }
}

export async function runSql(
  workspace: Workspace,
  sql: string,
  source?: string,
  params: Record<string, ParamValue> = {},
): Promise<QueryResult> {
  const datasource = await workspace.source(source)
  return datasource.query(sql, params, {
    maxRows: workspace.config.maxRows,
    timeoutMs: workspace.config.timeoutMs,
  })
}
