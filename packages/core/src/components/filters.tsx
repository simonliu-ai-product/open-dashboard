import { useEffect, useId } from 'react'
import { useFilters } from '../runtime/context.js'
import { humanize } from '../runtime/shape.js'
import {
  isTimePreset,
  TIME_PRESETS,
  type TimePreset,
  timeRangeParams,
} from '../runtime/time-range.js'
import { useQuery } from '../runtime/use-query.js'
import type { FilterSpec } from './layout.js'

export interface TimeRangeProps {
  /**
   * Omit to bind `:from` and `:to`. With a name, binds `:<name>_from` and
   * `:<name>_to` — for a second, independent range on the same dashboard.
   */
  name?: string
  label?: string
  default?: TimePreset
  /** Presets offered, in order. Default: every preset. */
  options?: TimePreset[]
}

function timeSpec(props: TimeRangeProps): FilterSpec {
  const fallback: TimePreset = props.default ?? '30d'
  return {
    key: props.name ?? 'time',
    default: fallback,
    params: (value) => timeRangeParams(props.name, isTimePreset(value) ? value : fallback),
  }
}

export function TimeRange(props: TimeRangeProps) {
  const id = useId()
  const { values, set } = useFilters()
  const spec = timeSpec(props)
  const value = values[spec.key] ?? spec.default
  const options = props.options ?? (Object.keys(TIME_PRESETS) as TimePreset[])
  return (
    <label className="odd-filter" htmlFor={id}>
      <span>{props.label ?? 'Time range'}</span>
      <select id={id} value={value ?? ''} onChange={(event) => set(spec.key, event.target.value)}>
        {options.map((preset) => (
          <option key={preset} value={preset}>
            {TIME_PRESETS[preset]}
          </option>
        ))}
      </select>
    </label>
  )
}
TimeRange.filterSpec = timeSpec as (props: Record<string, unknown>) => FilterSpec

export interface SelectProps {
  /** Binds `:<name>`. "All" binds NULL — write `(:name IS NULL OR col = :name)`. */
  name: string
  label?: string
  /** A query whose first column is the value and optional second column the label. */
  query?: string
  options?: (string | { value: string; label: string })[]
  default?: string | null
  /** Offer an "All" choice that binds NULL. Default true. */
  allowAll?: boolean
  allLabel?: string
}

function selectSpec(props: SelectProps): FilterSpec {
  return {
    key: props.name,
    default: props.default ?? null,
    params: (value) => ({ [props.name]: value }),
  }
}

export function Select(props: SelectProps) {
  const id = useId()
  const { values, set } = useFilters()
  const state = useQuery(props.query)
  const allowAll = props.allowAll !== false
  const value = values[props.name] ?? null

  let options: { value: string; label: string }[] = (props.options ?? []).map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  )
  const result = state.run?.result
  if (result && result.columns.length > 0) {
    const valueColumn = result.columns[0]?.name as string
    const labelColumn = (result.columns[1] ?? result.columns[0])?.name as string
    options = result.rows.map((row) => ({
      value: String(row[valueColumn]),
      label: String(row[labelColumn] ?? row[valueColumn]),
    }))
  }

  const first = options[0]?.value
  useEffect(() => {
    if (!allowAll && value === null && first !== undefined) set(props.name, first)
  }, [allowAll, value, first, set, props.name])

  return (
    <label className="odd-filter" htmlFor={id}>
      <span>{props.label ?? humanize(props.name)}</span>
      <select
        id={id}
        value={value ?? ''}
        onChange={(event) => set(props.name, event.target.value === '' ? null : event.target.value)}
      >
        {allowAll ? <option value="">{props.allLabel ?? 'All'}</option> : null}
        {value !== null && !options.some((o) => o.value === value) ? (
          <option value={value}>{value}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {state.status === 'error' ? (
        <em className="odd-filter-error" title={state.error}>
          !
        </em>
      ) : null}
    </label>
  )
}
Select.filterSpec = selectSpec as unknown as (props: Record<string, unknown>) => FilterSpec
