import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { Workspace } from '../workspace.js'
import { analyzeDashboard } from './analyze.js'
import { chartImports } from './charts.js'
import { dashboardQueries, discoverDashboards, listDashboards } from './dashboards.js'

export interface LintFinding {
  rule:
    | 'missing-meta-description'
    | 'unused-query'
    | 'missing-query-description'
    | 'unbounded-table-query'
    | 'high-panel-count'
    | 'duplicate-query'
    | 'refresh-without-live-source'
    | 'missing-expectations'
  severity: 'warning' | 'info'
  dashboard: string
  message: string
  where: string
}

export interface LintReport {
  id: string
  title: string
  findings: LintFinding[]
}

/** SQL as written, minus what does not change what it does: comments, spacing, case. */
function normalizedSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Shorter than this, two queries being alike says nothing: `SELECT DISTINCT region FROM sales`. */
const DUPLICATE_MIN_LENGTH = 80

export function lintWorkspace(workspace: Workspace, onlyId?: string): LintReport[] {
  const discovered = discoverDashboards(workspace.config.root, workspace.config.dashboardsDir)
  const list = onlyId ? discovered.filter((d) => d.id === onlyId) : discovered
  const reports: LintReport[] = []
  const summaries = new Map(listDashboards(workspace.config).map((s) => [s.id, s]))

  // Every dashboard's own queries, by their SQL: one written twice is one that drifts.
  const bySql = new Map<string, { dashboard: string; name: string }[]>()
  for (const item of discovered) {
    let own: ReturnType<typeof dashboardQueries>
    try {
      own = dashboardQueries(workspace.config, item.id)
    } catch {
      continue
    }
    for (const q of own.values()) {
      if (!q.file.startsWith(`${workspace.config.dashboardsDir}/`)) continue
      const key = normalizedSql(q.sql)
      if (key.length < DUPLICATE_MIN_LENGTH) continue
      bySql.set(key, [...(bySql.get(key) ?? []), { dashboard: item.id, name: q.name }])
    }
  }

  for (const item of list) {
    const rel = relative(workspace.config.root, item.file)
    const code = readFileSync(item.file, 'utf8')
    const custom = new Map(
      [...chartImports(workspace.config, item.file, code)].map(([name, chart]) => [
        name,
        chart.spec.columns,
      ]),
    )
    const analysis = analyzeDashboard(code, custom, item.file)
    const title = typeof analysis.meta.title === 'string' ? analysis.meta.title : item.id
    const findings: LintFinding[] = []

    if (typeof analysis.meta.description !== 'string' || analysis.meta.description.trim() === '') {
      findings.push({
        rule: 'missing-meta-description',
        severity: 'info',
        dashboard: item.id,
        message: 'meta.description is missing — add a short summary for readers and agents',
        where: rel,
      })
    }

    if (analysis.panels.length > 10 && !/<\s*(Section|Tabs)\b/.test(code)) {
      findings.push({
        rule: 'high-panel-count',
        severity: 'warning',
        dashboard: item.id,
        message: `${analysis.panels.length} panels without <Section> or <Tabs> grouping`,
        where: rel,
      })
    }

    const summary = summaries.get(item.id)
    if (summary?.refresh && summary.freshness.live.length === 0) {
      findings.push({
        rule: 'refresh-without-live-source',
        severity: 'info',
        dashboard: item.id,
        message: `meta.refresh is ${summary.refresh}, but no source it reads is live (${[...summary.freshness.collected, ...summary.freshness.static].join(', ')}) — it refreshes only where its collectors run, never in a build made elsewhere`,
        where: rel,
      })
    }

    let queries: ReturnType<typeof dashboardQueries> | undefined
    try {
      queries = dashboardQueries(workspace.config, item.id)
    } catch {
      queries = undefined
    }

    if (queries) {
      const referenced = new Set<string>(analysis.queryRefs.map((r) => r.name))
      for (const q of queries.values()) {
        for (const dep of q.uses ?? []) referenced.add(dep)
      }

      for (const [qName, q] of queries.entries()) {
        const isLocal = q.file.startsWith(`${workspace.config.dashboardsDir}/`)
        if (isLocal && !referenced.has(qName)) {
          findings.push({
            rule: 'unused-query',
            severity: 'warning',
            dashboard: item.id,
            message: `query "${qName}" is defined but not used by any panel or filter`,
            where: `${q.file}:${q.line}`,
          })
        }
        if (referenced.has(qName) && (!q.description || q.description.trim() === '')) {
          findings.push({
            rule: 'missing-query-description',
            severity: 'info',
            dashboard: item.id,
            message: `query "${qName}" has no "-- description:" comment`,
            where: `${q.file}:${q.line}`,
          })
        }
      }

      for (const [qName, q] of queries.entries()) {
        if (!q.file.startsWith(`${workspace.config.dashboardsDir}/`)) continue
        const twins = (bySql.get(normalizedSql(q.sql)) ?? []).filter((t) => t.dashboard !== item.id)
        if (twins.length === 0) continue
        findings.push({
          rule: 'duplicate-query',
          severity: 'warning',
          dashboard: item.id,
          message: `query "${qName}" is the same SQL as ${twins.map((t) => `"${t.name}" in ${t.dashboard}`).join(', ')} — move it to queries/*.sql and name it from each`,
          where: `${q.file}:${q.line}`,
        })
      }

      const own = [...queries.values()].filter(
        (q) => q.file.startsWith(`${workspace.config.dashboardsDir}/`) && referenced.has(q.name),
      )
      if (own.length > 0 && !own.some((q) => q.expects?.length)) {
        findings.push({
          rule: 'missing-expectations',
          severity: 'info',
          dashboard: item.id,
          message:
            'no query has an -- expect: rule — write the invariants you know (rows > 0, unique key, share between 0 and 1) so check catches a wrong number',
          where: rel,
        })
      }

      for (const panel of analysis.panels) {
        if (panel.component !== 'Table' || !panel.query) continue
        const q = queries.get(panel.query)
        if (!q || (q.uses && q.uses.length > 0)) continue
        const sqlUpper = q.sql.toUpperCase()
        if (!/\bLIMIT\b/.test(sqlUpper) && !/\bGROUP\s+BY\b/.test(sqlUpper)) {
          findings.push({
            rule: 'unbounded-table-query',
            severity: 'warning',
            dashboard: item.id,
            message: `<Table title="${panel.title ?? ''}"> query "${q.name}" has no LIMIT or GROUP BY`,
            where: `${q.file}:${q.line}`,
          })
        }
      }
    }

    reports.push({ id: item.id, title, findings })
  }

  return reports
}
