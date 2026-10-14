import { readFileSync } from 'node:fs'
import type { ParamValue } from '../config.js'
import { humanize } from '../runtime/shape.js'
import { isTimePreset, isTimeValue, TIME_PRESETS, timeRangeParams } from '../runtime/time-range.js'
import type { Workspace } from '../workspace.js'
import { analyzeDashboard } from './analyze.js'
import { chartImports } from './charts.js'
import { dashboardFile, runDashboardQuery } from './dashboards.js'

/** A filter as the reader meets it: every value they can pick, and what each binds. */
export interface FilterChoice {
  /** The key in the URL (`time`, `region`). */
  key: string
  kind: 'TimeRange' | 'Select' | 'MultiSelect' | 'SearchInput' | 'Toggle' | 'NumberRange'
  label: string
  /** Every value on offer, as the page holds it — strings, `null` for All. */
  options: (string | null)[]
  /** What the page shows for a value, where it differs from the value. */
  labels: Record<string, string>
  /** The value set now: the one asked for, else the default the page opens with. */
  current: string | null
  /** The parameters it binds. */
  produces: string[]
  params(value: string | null): Record<string, ParamValue>
}

export interface FilterOptions {
  now?: Date
  /** Values set by the reader, by key, as the URL has them; unset keys keep their default. */
  values?: Record<string, string | null>
  /** Values taken from a Select's options query. Default 50. */
  maxOptions?: number
}

/** The parameters for a set of filter values: each filter's current value unless overridden. */
export function filterParams(
  choices: FilterChoice[],
  overrides: Record<string, string | null> = {},
): Record<string, ParamValue> {
  return Object.assign(
    {},
    ...choices.map((choice) =>
      choice.params(choice.key in overrides ? (overrides[choice.key] ?? null) : choice.current),
    ),
  )
}

/**
 * A dashboard's filters, read statically like `check` reads them — literal
 * props only — with a `<Select>`'s options taken from its query, run as the
 * page first runs it. Time ranges resolve against `now`.
 */
export async function dashboardFilters(
  workspace: Workspace,
  id: string,
  options: FilterOptions = {},
): Promise<FilterChoice[]> {
  const now = options.now ?? new Date()
  const set = options.values ?? {}
  const config = workspace.config
  const file = dashboardFile(config, id)
  const code = readFileSync(file, 'utf8')
  const custom = new Map(
    [...chartImports(config, file, code)].map(([name, chart]) => [name, chart.spec.columns]),
  )
  const { filters } = analyzeDashboard(code, custom, file)

  const choices: FilterChoice[] = []
  const queries = new Map<FilterChoice, string>()
  const allowAll = new Map<FilterChoice, boolean>()
  for (const decl of filters) {
    if (decl.kind === 'TimeRange') {
      const key = decl.name ?? 'time'
      const fallback = isTimeValue(set[key]) ? (set[key] as string) : (decl.default ?? '30d')
      if (!isTimeValue(fallback)) continue
      const presets = (decl.options ?? Object.keys(TIME_PRESETS)).filter(isTimePreset)
      const produces = decl.name
        ? [
            `${decl.name}_from`,
            `${decl.name}_to`,
            ...(decl.compare ? [`${decl.name}_prev_from`, `${decl.name}_prev_to`] : []),
          ]
        : ['from', 'to', ...(decl.compare ? ['prev_from', 'prev_to'] : [])]
      choices.push({
        key,
        kind: 'TimeRange',
        label: decl.label ?? 'Time range',
        options: presets,
        labels: Object.fromEntries(presets.map((preset) => [preset, TIME_PRESETS[preset]])),
        current: fallback,
        produces,
        params: (value) =>
          timeRangeParams(decl.name, isTimeValue(value) ? value : fallback, now, decl.compare),
      })
    } else if (decl.kind === 'SearchInput' && decl.name) {
      const name = decl.name
      const fallback = decl.default && decl.default.trim() !== '' ? decl.default.trim() : null
      choices.push({
        key: name,
        kind: 'SearchInput',
        label: decl.label ?? humanize(name),
        options: [fallback],
        labels: {},
        current: name in set ? (set[name] ?? null) : fallback,
        produces: [name],
        params: (value) => ({ [name]: value && value.trim() !== '' ? value.trim() : null }),
      })
    } else if (decl.kind === 'Toggle' && decl.name) {
      const name = decl.name
      const fallback = decl.default === '1' || decl.default === 'true' ? '1' : '0'
      choices.push({
        key: name,
        kind: 'Toggle',
        label: decl.label ?? humanize(name),
        options: ['0', '1'],
        labels: { '0': 'Off', '1': 'On' },
        current: name in set ? (set[name] ?? fallback) : fallback,
        produces: [name],
        params: (value) => ({ [name]: value === '1' || value === 'true' ? 1 : 0 }),
      })
    } else if (decl.kind === 'NumberRange' && decl.name) {
      const name = decl.name
      const fallback = decl.default ?? null
      const parseBound = (raw: string | null | undefined) => {
        if (!raw || !raw.includes('..')) return { min: null, max: null }
        const [l = '', r = ''] = raw.split('..', 2)
        return {
          min: l.trim() !== '' && Number.isFinite(Number(l)) ? Number(l) : null,
          max: r.trim() !== '' && Number.isFinite(Number(r)) ? Number(r) : null,
        }
      }
      choices.push({
        key: name,
        kind: 'NumberRange',
        label: decl.label ?? humanize(name),
        options: [fallback],
        labels: {},
        current: name in set ? (set[name] ?? null) : fallback,
        produces: [`${name}_min`, `${name}_max`],
        params: (value) => {
          const parsed = parseBound(value ?? fallback)
          return { [`${name}_min`]: parsed.min, [`${name}_max`]: parsed.max }
        },
      })
    } else if (decl.name) {
      const name = decl.name
      const choice: FilterChoice = {
        key: name,
        kind: decl.kind === 'MultiSelect' ? 'MultiSelect' : 'Select',
        label: decl.label ?? humanize(name),
        options: [...(decl.allowAll ? [null] : []), ...(decl.options ?? [])],
        labels: { ...decl.optionLabels },
        current: name in set ? (set[name] ?? null) : (decl.default ?? null),
        produces: [name],
        params: (value) => ({ [name]: value && value.trim() !== '' ? value.trim() : null }),
      }
      choices.push(choice)
      allowAll.set(choice, decl.allowAll)
      if (decl.query && !decl.options) queries.set(choice, decl.query)
    }
  }

  for (const [choice, query] of queries) {
    try {
      const run = await runDashboardQuery(workspace, id, query, filterParams(choices))
      const [value, label] = run.result.columns.map((column) => column.name)
      if (!value) continue
      for (const row of run.result.rows.slice(0, options.maxOptions ?? 50)) {
        const text = String(row[value])
        choice.options.push(text)
        if (label && row[label] !== undefined && String(row[label]) !== text)
          choice.labels[text] = String(row[label])
      }
    } catch {
      // the options query's own error shows where it runs
    }
  }
  // A Select with no "All" and no default settles on its first option, as the page does.
  for (const choice of choices)
    if (choice.kind === 'Select' && choice.current === null && !allowAll.get(choice))
      choice.current = choice.options.find((option) => option !== null) ?? null
  return choices
}
