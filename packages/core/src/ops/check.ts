import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { ParamValue } from '../config.js'
import { referencedParams } from '../datasource/params.js'
import { errorMessage } from '../datasource/types.js'
import { isTimePreset, timeRangeParams } from '../runtime/time-range.js'
import type { Workspace } from '../workspace.js'
import { analyzeDashboard, type FilterDecl } from './analyze.js'
import { dashboardQueries, discoverDashboards, runDashboardQuery } from './dashboards.js'

export type Severity = 'error' | 'warning'

export interface Finding {
  severity: Severity
  message: string
  where?: string
}

export interface QueryReport {
  name: string
  source?: string
  rows?: number
  columns?: string[]
  elapsedMs?: number
  error?: string
}

export interface DashboardReport {
  id: string
  title: string
  params: Record<string, ParamValue>
  queries: QueryReport[]
  findings: Finding[]
}

/**
 * The params the dashboard opens with, worked out from the filters as written —
 * the same defaults the browser applies on first load.
 */
async function defaultParams(
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
      if (!isTimePreset(preset)) {
        findings.push({
          severity: 'error',
          message: `TimeRange default "${preset}" is not a preset`,
          where,
        })
        continue
      }
      Object.assign(params, timeRangeParams(filter.name, preset, now))
      continue
    }
    if (!filter.name) {
      findings.push({ severity: 'error', message: 'Select needs a literal name', where })
      continue
    }
    if (filter.default !== undefined) {
      params[filter.name] = filter.default
    } else if (filter.allowAll) {
      params[filter.name] = null
    } else if (filter.query) {
      try {
        const run = await runDashboardQuery(workspace, id, filter.query, params)
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

export async function checkDashboard(
  workspace: Workspace,
  id: string,
  file: string,
  now = new Date(),
): Promise<DashboardReport> {
  const rel = relative(workspace.config.root, file)
  const findings: Finding[] = []
  const analysis = analyzeDashboard(readFileSync(file, 'utf8'))
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

  report.params = await defaultParams(workspace, id, analysis.filters, findings, rel, now)

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
    analysis.filters.filter((f) => f.kind === 'Select' && f.name).map((f) => f.name),
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
  for (const [name, query] of queries) {
    if (!used.has(name)) {
      findings.push({
        severity: 'warning',
        message: `query "${name}" is defined but no panel uses it`,
        where: `${query.file}:${query.line}`,
      })
    }
  }

  const results = new Map<string, string[]>()
  for (const [name, query] of queries) {
    const entry: QueryReport = { name }
    const unbound = referencedParams(query.sql).filter((param) => !(param in report.params))
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
      const run = await runDashboardQuery(workspace, id, name, report.params)
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

  return report
}

export async function checkWorkspace(
  workspace: Workspace,
  only?: string,
): Promise<DashboardReport[]> {
  const found = discoverDashboards(workspace.config.root, workspace.config.dashboardsDir).filter(
    (entry) => !only || entry.id === only,
  )
  const reports: DashboardReport[] = []
  for (const entry of found) reports.push(await checkDashboard(workspace, entry.id, entry.file))
  return reports
}
