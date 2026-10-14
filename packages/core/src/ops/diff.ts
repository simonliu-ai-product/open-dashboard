import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { snapshotKey } from '../runtime/snapshot.js'
import type { QueryRun } from '../runtime/types.js'
import type { Workspace } from '../workspace.js'
import { dashboardQueries, discoverDashboards, runDashboardQuery } from './dashboards.js'
import { dashboardFilters, filterParams } from './filters.js'
import type { SnapshotQuery } from './snapshot.js'

export interface MetricDelta {
  column: string
  before: number
  after: number
  delta: number
}

export interface QueryDiffEntry {
  dashboard: string
  query: string
  status: 'unchanged' | 'changed' | 'added' | 'missing'
  beforeRows: number | null
  afterRows: number
  rowDelta: number | null
  metrics: MetricDelta[]
}

export async function diffWorkspace(
  workspace: Workspace,
  snapshotDir: string,
  onlyDashboard?: string,
): Promise<QueryDiffEntry[]> {
  const entries: QueryDiffEntry[] = []
  const dashboards = discoverDashboards(
    workspace.config.root,
    workspace.config.dashboardsDir,
  ).filter((d) => !onlyDashboard || d.id === onlyDashboard)

  for (const { id } of dashboards) {
    const queries = dashboardQueries(workspace.config, id)
    const filters = await dashboardFilters(workspace, id)
    const params = filterParams(filters)

    for (const name of queries.keys()) {
      const live = await runDashboardQuery(workspace, id, name, params, { fresh: true })
      const afterRows = live.result.rows.length
      const snapFile = join(snapshotDir, 'data', 'd', id, `${name}.json`)
      if (!existsSync(snapFile)) {
        entries.push({
          dashboard: id,
          query: name,
          status: 'added',
          beforeRows: null,
          afterRows,
          rowDelta: null,
          metrics: [],
        })
        continue
      }
      let stored: SnapshotQuery
      try {
        stored = JSON.parse(readFileSync(snapFile, 'utf8')) as SnapshotQuery
      } catch {
        continue
      }
      const key = snapshotKey(params, stored.reads)
      const hit = (stored.results[key] ?? Object.values(stored.results)[0]) as
        | QueryRun
        | { error: string }
        | undefined
      if (!hit || 'error' in hit) {
        entries.push({
          dashboard: id,
          query: name,
          status: 'added',
          beforeRows: null,
          afterRows,
          rowDelta: null,
          metrics: [],
        })
        continue
      }
      const beforeRows = hit.result.rows.length
      const rowDelta = afterRows - beforeRows
      const metrics: MetricDelta[] = []
      const firstBefore = hit.result.rows[0]
      const firstAfter = live.result.rows[0]
      if (firstBefore && firstAfter) {
        for (const col of live.result.columns) {
          if (col.type !== 'number') continue
          const b = Number(firstBefore[col.name])
          const a = Number(firstAfter[col.name])
          if (Number.isFinite(b) && Number.isFinite(a) && Math.abs(a - b) > 1e-9) {
            metrics.push({ column: col.name, before: b, after: a, delta: a - b })
          }
        }
      }
      entries.push({
        dashboard: id,
        query: name,
        status: rowDelta !== 0 || metrics.length > 0 ? 'changed' : 'unchanged',
        beforeRows,
        afterRows,
        rowDelta,
        metrics,
      })
    }
  }
  return entries
}
