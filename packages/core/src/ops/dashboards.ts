import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ParamValue, QueryResult } from '../config.js'
import { loadQueries, type NamedQuery } from '../queries/load.js'
import type { ResolvedConfig, Workspace } from '../workspace.js'
import { analyzeDashboard } from './analyze.js'
import { OpsError } from './errors.js'

const ENTRY_NAMES = ['index.tsx', 'index.jsx']
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

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
    const { meta, panels } = analyzeDashboard(readFileSync(file, 'utf8'))
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
    return summary
  })
}

export function dashboardQueries(config: ResolvedConfig, id: string): Map<string, NamedQuery> {
  return loadQueries(dashboardDir(config, id), config.root)
}

export interface QueryRun {
  query: { name: string; source: string; sql: string; file: string; line: number }
  params: Record<string, ParamValue>
  result: QueryResult
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
): Promise<QueryRun> {
  const queries = dashboardQueries(workspace.config, id)
  const query = queries.get(name)
  if (!query) {
    const known = [...queries.keys()]
    throw new OpsError(
      `dashboard "${id}" has no query "${name}"${known.length ? ` — defined: ${known.join(', ')}` : ' — add it to a .sql file in the dashboard folder'}`,
      404,
    )
  }
  const source = workspace.sourceName(query.source)
  const datasource = await workspace.source(source)
  const result = await datasource.query(query.sql, params, {
    maxRows: workspace.config.maxRows,
    timeoutMs: workspace.config.timeoutMs,
  })
  return {
    query: { name, source, sql: query.sql, file: query.file, line: query.line },
    params,
    result,
  }
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
