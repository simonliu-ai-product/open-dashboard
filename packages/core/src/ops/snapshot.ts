import { readFileSync } from 'node:fs'
import type { ParamValue } from '../config.js'
import { errorMessage } from '../datasource/types.js'
import { snapshotKey } from '../runtime/snapshot.js'
import { isTimePreset, TIME_PRESETS, timeRangeParams } from '../runtime/time-range.js'
import type { QueryRun } from '../runtime/types.js'
import type { Workspace } from '../workspace.js'
import { analyzeDashboard, type FilterDecl } from './analyze.js'
import { chartImports } from './charts.js'
import { dashboardFile, dashboardQueries, readsOf, runDashboardQuery } from './dashboards.js'

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
}

/** A filter as the browser applies it: string values (null for "all"), each turned into params. */
interface Choice {
  values: (string | null)[]
  fallback: string | null
  produces: string[]
  params: (value: string | null) => Record<string, ParamValue>
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
  const file = dashboardFile(config, id)
  const code = readFileSync(file, 'utf8')
  const custom = new Map(
    [...chartImports(config, file, code)].map(([name, chart]) => [name, chart.spec.columns]),
  )
  const { filters } = analyzeDashboard(code, custom)
  const queries = dashboardQueries(config, id)

  const choices: { decl: FilterDecl; choice: Choice }[] = []
  for (const decl of filters) {
    if (decl.kind === 'TimeRange') {
      const fallback = decl.default ?? '30d'
      if (!isTimePreset(fallback)) continue
      const presets = (decl.options ?? Object.keys(TIME_PRESETS)).filter(isTimePreset)
      choices.push({
        decl,
        choice: {
          values: [...new Set([fallback, ...presets])],
          fallback,
          produces: decl.name ? [`${decl.name}_from`, `${decl.name}_to`] : ['from', 'to'],
          params: (value) =>
            timeRangeParams(decl.name, isTimePreset(value) ? value : fallback, now),
        },
      })
    } else if (decl.name) {
      const name = decl.name
      const fallback = decl.default ?? null
      choices.push({
        decl,
        choice: {
          // null too: a Select with no default opens empty before it picks its first option.
          values: [fallback, null, ...(decl.options ?? [])],
          fallback,
          produces: [name],
          params: (value) => ({ [name]: value }),
        },
      })
    }
  }

  const defaults = (): Record<string, ParamValue> =>
    Object.assign({}, ...choices.map(({ choice }) => choice.params(choice.fallback)))

  // A Select's options come from its query, run as the page first runs it.
  for (const { decl, choice } of choices) {
    if (decl.kind !== 'Select' || !decl.query || decl.options) continue
    try {
      const run = await runDashboardQuery(workspace, id, decl.query, defaults())
      const column = run.result.columns[0]?.name
      if (column)
        choice.values.push(
          ...run.result.rows.slice(0, maxOptions).map((row) => String(row[column])),
        )
    } catch {
      // the options query's error is stored with its results below
    }
  }
  for (const { choice } of choices) choice.values = [...new Set(choice.values)]

  const snapshot: DashboardSnapshot = { id, queries: {}, runs: 0, trimmed: [] }
  for (const name of queries.keys()) {
    const reads = [...new Set(readsOf(config, queries, name))].sort()
    const relevant = choices
      .map(({ choice }) => choice)
      .filter((choice) => choice.produces.some((param) => reads.includes(param)))
    const lists = relevant.map((choice) => choice.values)
    const size = () => lists.reduce((n, values) => n * values.length, 1)
    if (size() > maxRuns) snapshot.trimmed.push(name)
    while (size() > maxRuns) {
      const widest = lists.reduce(
        (best, values, i) => (values.length > (lists[best]?.length ?? 0) ? i : best),
        0,
      )
      lists[widest] = [relevant[widest]?.fallback ?? null]
    }

    const stored: SnapshotQuery = { reads, results: {} }
    for (const combo of product(lists)) {
      const params = defaults()
      combo.forEach((value, i) => {
        Object.assign(params, relevant[i]?.params(value))
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
