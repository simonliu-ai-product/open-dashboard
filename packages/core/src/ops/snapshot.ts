import type { ParamValue } from '../config.js'
import { errorMessage } from '../datasource/types.js'
import { snapshotKey } from '../runtime/snapshot.js'
import type { QueryRun } from '../runtime/types.js'
import type { Workspace } from '../workspace.js'
import { dashboardQueries, readsOf, runDashboardQuery } from './dashboards.js'
import { dashboardFilters, filterParams } from './filters.js'

/** What `open-dashboard build` stores for one query: every run, by the parameters it reads. */
export interface SnapshotQuery {
  reads: string[]
  results: Record<string, QueryRun | { error: string }>
}

export interface DashboardSnapshot {
  id: string
  queries: Record<string, SnapshotQuery>
  runs: number
  /** Queries that would need more runs than allowed: some filters kept their default there. */
  trimmed: string[]
}

export interface SnapshotOptions {
  /** Runs allowed per query; past it, the filters with the most values fall back to their default. */
  maxRuns?: number
  /** Values taken from a Select's options query. */
  maxOptions?: number
  now?: Date
  /** Filter values to open at, by filter key as the URL has them, in place of the defaults. */
  values?: Record<string, string | null>
}

function product(lists: (string | null)[][]): (string | null)[][] {
  return lists.reduce<(string | null)[][]>(
    (combos, values) => combos.flatMap((combo) => values.map((value) => [...combo, value])),
    [[]],
  )
}

/**
 * The page's results, taken ahead of time. For every query, every combination
 * of the values of the filters it reads — presets of a `<TimeRange>`, options
 * of a `<Select>` — is run once, so a reader can still change the filters. A
 * query that would need more than `maxRuns` keeps its widest filters at their
 * default instead. Time ranges are resolved against `now`, the moment the
 * snapshot was taken, and the page resolves them against the same moment.
 */
export async function snapshotDashboard(
  workspace: Workspace,
  id: string,
  options: SnapshotOptions = {},
): Promise<DashboardSnapshot> {
  const now = options.now ?? new Date()
  const maxRuns = options.maxRuns ?? 100
  const maxOptions = options.maxOptions ?? 50
  const config = workspace.config
  const queries = dashboardQueries(config, id)
  const filters = await dashboardFilters(workspace, id, {
    now,
    maxOptions,
    ...(options.values ? { values: options.values } : {}),
  })
  // The values each filter is snapshotted at: its current one first, null too
  // for a Select — one with no default opens empty before it picks.
  const choices = filters.map((filter) => ({
    filter,
    values: [
      ...new Set([filter.current, ...(filter.kind === 'Select' ? [null] : []), ...filter.options]),
    ],
  }))
  const defaults = (): Record<string, ParamValue> => filterParams(filters)

  const snapshot: DashboardSnapshot = { id, queries: {}, runs: 0, trimmed: [] }
  for (const name of queries.keys()) {
    const reads = [...new Set(readsOf(config, queries, name))].sort()
    const relevant = choices.filter(({ filter }) =>
      filter.produces.some((param) => reads.includes(param)),
    )
    const lists = relevant.map((choice) => choice.values)
    const size = () => lists.reduce((n, values) => n * values.length, 1)
    if (size() > maxRuns) snapshot.trimmed.push(name)
    while (size() > maxRuns) {
      const widest = lists.reduce(
        (best, values, i) => (values.length > (lists[best]?.length ?? 0) ? i : best),
        0,
      )
      lists[widest] = [relevant[widest]?.filter.current ?? null]
    }

    const stored: SnapshotQuery = { reads, results: {} }
    for (const combo of product(lists)) {
      const params = defaults()
      combo.forEach((value, i) => {
        Object.assign(params, relevant[i]?.filter.params(value))
      })
      const key = snapshotKey(params, reads)
      if (key in stored.results) continue
      try {
        const run = await runDashboardQuery(workspace, id, name, params)
        // The SQL and where it lives stay with the workspace; the page needs the rows.
        stored.results[key] = {
          query: { name, source: run.query.source, sql: '', file: '', line: 0 },
          params: Object.fromEntries(reads.map((param) => [param, params[param] ?? null])),
          result: run.result,
          ...(run.ranAt ? { ranAt: run.ranAt } : {}),
        }
      } catch (error) {
        stored.results[key] = { error: errorMessage(error) }
      }
      snapshot.runs += 1
    }
    snapshot.queries[name] = stored
  }
  return snapshot
}
