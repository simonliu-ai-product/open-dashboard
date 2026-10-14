import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ParamValue } from '../config.js'
import type { NamedQuery } from '../queries/load.js'
import type { QueryAlertResult } from '../runtime/types.js'
import type { Workspace } from '../workspace.js'
import { analyzeDashboard } from './analyze.js'
import { chartImports } from './charts.js'
import { dashboardQueries, listDashboards, runDashboardQuery } from './dashboards.js'
import { dashboardFilters, filterParams } from './filters.js'

export interface DashboardQuerySummary {
  name: string
  source: string
  rows: number
  elapsedMs: number
  headline: Record<string, unknown> | null
  alerts: QueryAlertResult[]
}

export interface DashboardReportSection {
  id: string
  title: string
  description?: string
  params: Record<string, ParamValue>
  alerts: QueryAlertResult[]
  queries: DashboardQuerySummary[]
}

export interface WorkspaceReport {
  generatedAt: string
  dashboards: DashboardReportSection[]
  alertsTriggered: number
  markdown: string
}

function formatNum(v: number): string {
  return Number.isInteger(v)
    ? v.toLocaleString('en-US')
    : v.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function formatHeadline(row: Record<string, unknown> | null): string {
  if (!row) return '—'
  const pairs = Object.entries(row)
    .slice(0, 4)
    .map(([k, v]) => {
      if (typeof v === 'number') {
        const formatted = Number.isInteger(v)
          ? v.toLocaleString('en-US')
          : v.toLocaleString('en-US', { maximumFractionDigits: 3 })
        return `${k}: ${formatted}`
      }
      return `${k}: ${v ?? 'null'}`
    })
  return pairs.join(', ')
}

function reachedQueries(
  workspace: Workspace,
  relFile: string,
  queries: Map<string, NamedQuery>,
): Set<string> {
  const file = join(workspace.config.root, relFile)
  const code = readFileSync(file, 'utf8')
  const custom = new Map(
    [...chartImports(workspace.config, file, code)].map(([name, chart]) => [
      name,
      chart.spec.columns,
    ]),
  )
  const analysis = analyzeDashboard(code, custom, file)
  const reached = new Set<string>()
  const reach = (name: string): void => {
    if (reached.has(name)) return
    reached.add(name)
    for (const input of queries.get(name)?.uses ?? []) reach(input)
  }
  for (const ref of analysis.queryRefs) reach(ref.name)
  return reached
}

export async function generateReport(
  workspace: Workspace,
  onlyDashboard?: string,
  options: { webhook?: string; now?: Date } = {},
): Promise<WorkspaceReport> {
  const now = options.now ?? new Date()
  const generatedAt = now.toISOString()
  const summaries = listDashboards(workspace.config).filter(
    (d) => !onlyDashboard || d.id === onlyDashboard,
  )

  const sections: DashboardReportSection[] = []
  let alertsTriggered = 0

  for (const meta of summaries) {
    const queries = dashboardQueries(workspace.config, meta.id)
    const reached = reachedQueries(workspace, meta.file, queries)
    const filters = await dashboardFilters(workspace, meta.id, { now })
    const params = filterParams(filters)
    const querySummaries: DashboardQuerySummary[] = []
    const activeAlerts: QueryAlertResult[] = []

    for (const [name, q] of queries) {
      const isShared = q.file.startsWith('queries/') || q.file.startsWith('queries\\')
      if (isShared && !reached.has(name)) continue
      const ran = await runDashboardQuery(workspace, meta.id, name, params, { fresh: true })
      const triggered = (ran.alerts ?? []).filter((a) => a.triggered)
      activeAlerts.push(...triggered)
      alertsTriggered += triggered.length
      querySummaries.push({
        name,
        source: ran.query.source,
        rows: ran.result.rows.length,
        elapsedMs: Math.round(ran.result.elapsedMs),
        headline: (ran.result.rows[0] as Record<string, unknown> | undefined) ?? null,
        alerts: triggered,
      })
    }

    sections.push({
      id: meta.id,
      title: meta.title,
      ...(meta.description ? { description: meta.description } : {}),
      params,
      alerts: activeAlerts,
      queries: querySummaries,
    })
  }

  const lines: string[] = [
    `# Open Dashboard Report`,
    ``,
    `- **Generated at**: ${generatedAt}`,
    `- **Dashboards**: ${sections.length}`,
    `- **Active alerts**: ${alertsTriggered}`,
    ``,
  ]

  for (const section of sections) {
    lines.push(`## ${section.title} (\`${section.id}\`)`)
    if (section.description) lines.push(`${section.description}`)
    const paramText = Object.entries(section.params)
      .map(([k, v]) => `${k}=${v === null ? 'null' : v}`)
      .join(' ')
    if (paramText) lines.push(`- **Params**: \`${paramText}\``)
    lines.push(``)

    if (section.alerts.length > 0) {
      lines.push(`### ⚠️ Active Alerts`)
      for (const alert of section.alerts) {
        const actualText =
          typeof alert.actual === 'number' ? formatNum(alert.actual) : String(alert.actual)
        const detail = alert.message
          ? `${alert.message} (\`${alert.column} = ${actualText}\`, rule: \`${alert.rule}\`)`
          : `\`${alert.column} = ${actualText}\` triggered \`${alert.rule}\``
        lines.push(`- **Alert**: ${detail}`)
      }
      lines.push(``)
    }

    lines.push(`| Query | Source | Rows | Time | Headline / First Row |`)
    lines.push(`| :--- | :--- | ---: | ---: | :--- |`)
    for (const q of section.queries) {
      lines.push(
        `| \`${q.name}\` | ${q.source} | ${q.rows} | ${q.elapsedMs} ms | ${formatHeadline(q.headline)} |`,
      )
    }
    lines.push(``)
  }

  const markdown = lines.join('\n')
  const report: WorkspaceReport = {
    generatedAt,
    dashboards: sections,
    alertsTriggered,
    markdown,
  }

  if (options.webhook) {
    const res = await fetch(options.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: markdown,
        content: markdown,
        report,
      }),
    })
    if (!res.ok) {
      throw new Error(`webhook POST failed with status ${res.status}`)
    }
  }

  return report
}
