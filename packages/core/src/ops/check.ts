import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { ParamValue } from '../config.js'
import { errorMessage } from '../datasource/types.js'
import type { NamedQuery } from '../queries/load.js'
import { isTimePreset, timeRangeParams } from '../runtime/time-range.js'
import type { Workspace } from '../workspace.js'
import { analyzeDashboard, type FilterDecl } from './analyze.js'
import { chartImports } from './charts.js'
import {
  dashboardQueries,
  discoverDashboards,
  queryParams,
  runDashboardQuery,
} from './dashboards.js'
import { checkExpectations, type ExpectationResult } from './expect.js'
import { snapshotDashboard } from './snapshot.js'

export type Severity = 'error' | 'warning'

export interface Finding {
  severity: Severity
  message: string
  where?: string
}

import type { QueryAlertResult } from '../runtime/types.js'

export interface QueryReport {
  name: string
  source?: string
  rows?: number
  columns?: string[]
  elapsedMs?: number
  alerts?: QueryAlertResult[]
  expectations?: ExpectationResult[]
  error?: string
}

export interface CheckOptions {
  now?: Date
  /** Filter params to check at in place of the defaults, by param name. */
  params?: Record<string, ParamValue>
  /** Also run every query over the filter combinations a build would store. */
  allParams?: boolean
  /** Runs per query for `allParams`, as `build --max-runs`. Default 100. */
  maxRuns?: number
  /** A query slower than this is reported. Default 1000. */
  slowMs?: number
}

/** Runs across the filter combinations, when `allParams` swept them. */
export interface SweepReport {
  runs: number
  failedRuns: number
  /** The slowest query by its time summed over every run — what a build pays. */
  slowest: { name: string; runs: number; totalMs: number }[]
}

export interface DashboardReport {
  id: string
  title: string
  params: Record<string, ParamValue>
  queries: QueryReport[]
  findings: Finding[]
  sweep?: SweepReport
}

/**
 * The params the dashboard opens with, worked out from the filters as written —
 * the same defaults the browser applies on first load.
 */
export async function defaultParams(
  workspace: Workspace,
  id: string,
  filters: FilterDecl[],
  findings: Finding[],
  file: string,
  now: Date,
): Promise<Record<string, ParamValue>> {
  const params: Record<string, ParamValue> = {}
  for (const filter of filters) {
    const where = `${file}:${filter.line}`
    if (filter.kind === 'TimeRange') {
      const preset = filter.default ?? '30d'
      if (!isTimePreset(preset) && !/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/.test(preset)) {
        findings.push({
          severity: 'error',
          message: `TimeRange default "${preset}" is not a preset`,
          where,
        })
        continue
      }
      Object.assign(params, timeRangeParams(filter.name, preset, now, filter.compare))
      continue
    }
    if (!filter.name) {
      findings.push({ severity: 'error', message: `${filter.kind} needs a literal name`, where })
      continue
    }
    if (filter.kind === 'Toggle') {
      params[filter.name] = filter.default === '1' || filter.default === 'true' ? 1 : 0
      continue
    }
    if (filter.kind === 'SearchInput') {
      params[filter.name] =
        filter.default && filter.default.trim() !== '' ? filter.default.trim() : null
      continue
    }
    if (filter.kind === 'NumberRange') {
      const raw = filter.default
      if (raw && raw.includes('..')) {
        const [l = '', r = ''] = raw.split('..', 2)
        params[`${filter.name}_min`] =
          l.trim() !== '' && Number.isFinite(Number(l)) ? Number(l) : null
        params[`${filter.name}_max`] =
          r.trim() !== '' && Number.isFinite(Number(r)) ? Number(r) : null
      } else {
        params[`${filter.name}_min`] = null
        params[`${filter.name}_max`] = null
      }
      continue
    }
    if (filter.default !== undefined) {
      params[filter.name] = filter.default
    } else if (filter.allowAll) {
      params[filter.name] = null
    } else if (filter.query) {
      try {
        const run = await runDashboardQuery(workspace, id, filter.query, params, { fresh: true })
        const first = run.result.rows[0]
        const column = run.result.columns[0]?.name
        params[filter.name] = first && column ? (first[column] as ParamValue) : null
      } catch {
        params[filter.name] = null
      }
    } else {
      params[filter.name] = null
    }
  }
  return params
}

/** The first loop of `-- uses:` reachable from `start`, ending where it began. */
function usesLoop(
  queries: Map<string, NamedQuery>,
  start: string,
  path: string[] = [],
): string[] | undefined {
  if (path.includes(start)) return [...path.slice(path.indexOf(start)), start]
  for (const input of queries.get(start)?.uses ?? []) {
    const loop = usesLoop(queries, input, [...path, start])
    if (loop) return loop
  }
  return undefined
}

export async function checkDashboard(
  workspace: Workspace,
  id: string,
  file: string,
  options: CheckOptions = {},
): Promise<DashboardReport> {
  const now = options.now ?? new Date()
  const slowMs = options.slowMs ?? 1000
  const rel = relative(workspace.config.root, file)
  const findings: Finding[] = []
  const code = readFileSync(file, 'utf8')
  const custom = new Map(
    [...chartImports(workspace.config, file, code)].map(([name, chart]) => [
      name,
      chart.spec.columns,
    ]),
  )
  const analysis = analyzeDashboard(code, custom, file)
  const title = typeof analysis.meta.title === 'string' ? analysis.meta.title : id
  const report: DashboardReport = { id, title, params: {}, queries: [], findings }

  if (typeof analysis.meta.title !== 'string') {
    findings.push({ severity: 'warning', message: 'meta.title is missing', where: rel })
  }

  let queries: ReturnType<typeof dashboardQueries>
  try {
    queries = dashboardQueries(workspace.config, id)
  } catch (error) {
    findings.push({ severity: 'error', message: errorMessage(error) })
    return report
  }

  report.params = {
    ...(await defaultParams(workspace, id, analysis.filters, findings, rel, now)),
    ...options.params,
  }

  for (const panel of analysis.panels) {
    if (!panel.title && panel.component !== 'Text') {
      findings.push({
        severity: 'warning',
        message: `<${panel.component}> has no title`,
        where: `${rel}:${panel.line}`,
      })
    }
    if (!panel.query && panel.component !== 'Text') {
      findings.push({
        severity: 'warning',
        message: `<${panel.component}${panel.title ? ` "${panel.title}"` : ''}> has no literal query — check cannot verify it`,
        where: `${rel}:${panel.line}`,
      })
    }
  }

  const selects = new Set(
    analysis.filters
      .filter((f) => (f.kind === 'Select' || f.kind === 'MultiSelect') && f.name)
      .map((f) => f.name),
  )
  for (const panel of analysis.panels) {
    if (!panel.drill || panel.drill.dashboard || selects.has(panel.drill.filter)) continue
    findings.push({
      severity: 'warning',
      message: `<${panel.component}${panel.title ? ` "${panel.title}"` : ''}> drills into "${panel.drill.filter}", but there is no <Select name="${panel.drill.filter}"> — clicks will do nothing`,
      where: `${rel}:${panel.line}`,
    })
  }

  const used = new Set(analysis.queryRefs.map((ref) => ref.name))
  for (const ref of analysis.queryRefs) {
    if (!queries.has(ref.name)) {
      findings.push({
        severity: 'error',
        message: `query "${ref.name}" is not defined in any .sql file of this dashboard`,
        where: `${rel}:${ref.line}`,
      })
    }
  }
  // A query another one reads with `-- uses:` is in use, and so is everything it reads.
  const reached = new Set<string>()
  const reach = (name: string): void => {
    if (reached.has(name)) return
    reached.add(name)
    for (const input of queries.get(name)?.uses ?? []) reach(input)
  }
  for (const name of used) reach(name)
  for (const [name, query] of queries) {
    for (const input of query.uses ?? []) {
      if (!queries.has(input)) {
        findings.push({
          severity: 'error',
          message: `query "${name}" uses "${input}", which is not defined in this dashboard`,
          where: `${query.file}:${query.line}`,
        })
      }
    }
    const loop = usesLoop(queries, name)
    if (loop && loop[0] === name) {
      findings.push({
        severity: 'error',
        message: `queries use each other in a loop: ${loop.join(' → ')}`,
        where: `${query.file}:${query.line}`,
      })
    }
  }
  const isSharedQuery = (q: NamedQuery) =>
    q.file.startsWith('queries/') || q.file.startsWith('queries\\')

  for (const [name, query] of queries) {
    if (!reached.has(name) && !isSharedQuery(query)) {
      findings.push({
        severity: 'warning',
        message: `query "${name}" is defined but no panel uses it`,
        where: `${query.file}:${query.line}`,
      })
    }
  }

  const results = new Map<string, string[]>()
  for (const [name, query] of queries) {
    if (!reached.has(name) && isSharedQuery(query)) continue
    const entry: QueryReport = { name }
    const unbound = queryParams(workspace.config, query).filter(
      (param) => !(param in report.params),
    )
    if (unbound.length > 0) {
      entry.error = `uses ${unbound.map((p) => `:${p}`).join(', ')}, which no filter provides`
      findings.push({
        severity: 'error',
        message: `query "${name}" ${entry.error}`,
        where: `${query.file}:${query.line}`,
      })
      report.queries.push(entry)
      continue
    }
    try {
      const run = await runDashboardQuery(workspace, id, name, report.params, { fresh: true })
      entry.source = run.query.source
      entry.rows = run.result.rows.length
      entry.columns = run.result.columns.map((c) => c.name)
      entry.elapsedMs = Math.round(run.result.elapsedMs)
      results.set(name, entry.columns)
      if (entry.rows === 0 && used.has(name)) {
        findings.push({
          severity: 'warning',
          message: `query "${name}" returns no rows with the default filters`,
          where: `${query.file}:${query.line}`,
        })
      }
      if (run.result.truncated) {
        findings.push({
          severity: 'warning',
          message: `query "${name}" was truncated at ${workspace.config.maxRows} rows — aggregate in SQL`,
          where: `${query.file}:${query.line}`,
        })
      }
      if (run.result.elapsedMs > slowMs) {
        findings.push({
          severity: 'warning',
          message: `query "${name}" took ${entry.elapsedMs} ms (over ${slowMs} ms)${
            query.uses?.length
              ? ' — its -- uses: inputs run again for every query that uses them; a CTE named more than once re-runs too (AS MATERIALIZED)'
              : ''
          }`,
          where: `${query.file}:${query.line}`,
        })
      }
      if (query.expects?.length) {
        entry.expectations = checkExpectations(query.expects, run.result)
        for (const failed of entry.expectations.filter((e) => !e.ok)) {
          findings.push({
            severity: 'error',
            message: `query "${name}" expects ${failed.rule}: ${failed.message}`,
            where: `${query.file}:${query.line}`,
          })
        }
      }
      if (run.alerts?.length) {
        entry.alerts = run.alerts
        for (const alert of run.alerts) {
          if (alert.triggered) {
            findings.push({
              severity: 'warning',
              message: `alert on "${name}": ${alert.message ?? `${alert.column} (${alert.actual}) ${alert.op} ${alert.threshold}`}`,
              where: `${query.file}:${query.line}`,
            })
          }
        }
      }
    } catch (error) {
      entry.error = errorMessage(error)
      findings.push({
        severity: 'error',
        message: `query "${name}" failed: ${entry.error}`,
        where: `${query.file}:${query.line}`,
      })
    }
    report.queries.push(entry)
  }

  for (const ref of analysis.queryRefs) {
    const columns = results.get(ref.name)
    if (!columns || columns.length === 0) continue
    for (const column of ref.columns) {
      if (!columns.includes(column)) {
        findings.push({
          severity: 'error',
          message: `column "${column}" is not in the result of "${ref.name}" (has: ${columns.join(', ')})`,
          where: `${rel}:${ref.line}`,
        })
      }
    }
  }

  if (options.allParams && !findings.some((f) => f.severity === 'error')) {
    report.sweep = await sweepDashboard(workspace, id, queries, findings, now, options.maxRuns)
  }

  return report
}

/**
 * Every query over every filter combination a build would store: the default
 * filters are one reader's view, and a query can fail, break an expectation or
 * crawl for another one. Each problem is reported once, with the first params
 * it showed up at.
 */
async function sweepDashboard(
  workspace: Workspace,
  id: string,
  queries: Map<string, NamedQuery>,
  findings: Finding[],
  now: Date,
  maxRuns = 100,
): Promise<SweepReport> {
  const snapshot = await snapshotDashboard(workspace, id, { now, maxRuns })
  const sweep: SweepReport = { runs: snapshot.runs, failedRuns: 0, slowest: [] }
  const totals: SweepReport['slowest'] = []
  const at = (params: Record<string, ParamValue> | undefined) =>
    Object.entries(params ?? {})
      .map(([k, v]) => `${k}=${v === null ? 'null' : v}`)
      .join(' ') || 'no params'
  for (const [name, stored] of Object.entries(snapshot.queries)) {
    const query = queries.get(name)
    const where = query ? `${query.file}:${query.line}` : undefined
    const reported = new Set<string>()
    const total = { name, runs: 0, totalMs: 0 }
    for (const run of Object.values(stored.results)) {
      total.runs += 1
      if ('error' in run) {
        sweep.failedRuns += 1
        if (!reported.has('error')) {
          reported.add('error')
          findings.push({
            severity: 'error',
            message: `query "${name}" fails for some filter values: ${run.error}`,
            where,
          })
        }
        continue
      }
      total.totalMs += run.result.elapsedMs
      for (const failed of checkExpectations(query?.expects ?? [], run.result)) {
        if (failed.ok || reported.has(failed.rule)) continue
        reported.add(failed.rule)
        findings.push({
          severity: 'error',
          message: `query "${name}" expects ${failed.rule}, but at ${at(run.params)}: ${failed.message}`,
          where,
        })
      }
    }
    total.totalMs = Math.round(total.totalMs)
    totals.push(total)
  }
  sweep.slowest = totals.sort((a, b) => b.totalMs - a.totalMs).slice(0, 5)
  for (const name of snapshot.trimmed) {
    findings.push({
      severity: 'warning',
      message: `query "${name}" has more filter combinations than ${maxRuns}: some were checked at their defaults only`,
      where: queries.get(name)
        ? `${queries.get(name)?.file}:${queries.get(name)?.line}`
        : undefined,
    })
  }
  return sweep
}

export async function checkWorkspace(
  workspace: Workspace,
  only?: string,
  options: CheckOptions = {},
): Promise<DashboardReport[]> {
  const found = discoverDashboards(workspace.config.root, workspace.config.dashboardsDir).filter(
    (entry) => !only || entry.id === only,
  )
  const reports: DashboardReport[] = []
  for (const entry of found) {
    reports.push(await checkDashboard(workspace, entry.id, entry.file, options))
  }
  return reports
}
