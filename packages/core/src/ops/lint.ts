import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { Workspace } from '../workspace.js'
import { analyzeDashboard } from './analyze.js'
import { chartImports } from './charts.js'
import { dashboardQueries, discoverDashboards } from './dashboards.js'

export interface LintFinding {
  rule:
    | 'missing-meta-description'
    | 'unused-query'
    | 'missing-query-description'
    | 'unbounded-table-query'
    | 'high-panel-count'
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

export function lintWorkspace(workspace: Workspace, onlyId?: string): LintReport[] {
  const discovered = discoverDashboards(workspace.config.root, workspace.config.dashboardsDir)
  const list = onlyId ? discovered.filter((d) => d.id === onlyId) : discovered
  const reports: LintReport[] = []

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
