import { useEffect, useId, useRef, useState } from 'react'
import { useFilters } from '../runtime/context.js'
import { useT } from '../runtime/i18n.js'
import { humanize } from '../runtime/shape.js'
import {
  isCustomTimeRange,
  isTimeValue,
  resolveTimeRange,
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
  default?: TimePreset | string
  /** Presets offered, in order. Default: every preset. */
  options?: TimePreset[]
  /** Also bind `:prev_from` and `:prev_to` (or `:<name>_prev_from` / `:<name>_prev_to`) for the equal-length preceding period. */
  compare?: boolean
  /** Allow picking custom start/end dates (`YYYY-MM-DD..YYYY-MM-DD`). */
  allowCustom?: boolean
}

function timeSpec(props: TimeRangeProps): FilterSpec {
  const fallback: string = isTimeValue(props.default) ? props.default : '30d'
  return {
    key: props.name ?? 'time',
    default: fallback,
    params: (value) =>
      timeRangeParams(props.name, isTimeValue(value) ? value : fallback, undefined, props.compare),
  }
}

export function TimeRange(props: TimeRangeProps) {
  const t = useT()
  const id = useId()
  const { values, set } = useFilters()
  const spec = timeSpec(props)
  const value = values[spec.key] ?? spec.default ?? '30d'
  const options = props.options ?? (Object.keys(TIME_PRESETS) as TimePreset[])
  const custom = isCustomTimeRange(value)
  const resolved = resolveTimeRange(value)

  return (
    <div className="odd-filter-group">
      <label className="odd-filter" htmlFor={id}>
        <span>{props.label ?? t('Time range')}</span>
        <select
          id={id}
          value={custom ? 'custom' : value}
          onChange={(event) => {
            if (event.target.value === 'custom') {
              set(spec.key, `${resolved.from}..${resolved.to}`)
            } else {
              set(spec.key, event.target.value)
            }
          }}
        >
          {options.map((preset) => (
            <option key={preset} value={preset}>
              {t(TIME_PRESETS[preset])}
            </option>
          ))}
          {props.allowCustom || custom ? <option value="custom">{t('Custom range')}</option> : null}
        </select>
      </label>
      {custom ? (
        <div className="odd-filter odd-filter-dates" data-export-skip="">
          <input
            type="date"
            aria-label={t('Start date')}
            value={resolved.from}
            onChange={(e) => {
              if (e.target.value) set(spec.key, `${e.target.value}..${resolved.to}`)
            }}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date"
            aria-label={t('End date')}
            value={resolved.to}
            onChange={(e) => {
              if (e.target.value) set(spec.key, `${resolved.from}..${e.target.value}`)
            }}
          />
        </div>
      ) : null}
    </div>
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
  const t = useT()
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
        {allowAll ? <option value="">{props.allLabel ?? t('All')}</option> : null}
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

export interface SearchInputProps {
  /** Binds `:<name>`. Empty text binds NULL — write `(:name IS NULL OR col LIKE '%' || :name || '%')`. */
  name: string
  label?: string
  placeholder?: string
  default?: string | null
}

function searchSpec(props: SearchInputProps): FilterSpec {
  const fallback = props.default && props.default.trim() !== '' ? props.default.trim() : null
  return {
    key: props.name,
    default: fallback,
    params: (value) => ({ [props.name]: value && value.trim() !== '' ? value.trim() : null }),
  }
}

export function SearchInput(props: SearchInputProps) {
  const t = useT()
  const id = useId()
  const { values, set } = useFilters()
  const value = values[props.name] ?? ''
  return (
    <label className="odd-filter odd-filter-search" htmlFor={id}>
      <span>{props.label ?? humanize(props.name)}</span>
      <input
        id={id}
        type="search"
        value={value}
        placeholder={props.placeholder ?? t('Filter…')}
        onChange={(event) =>
          set(props.name, event.target.value.trim() === '' ? null : event.target.value)
        }
      />
    </label>
  )
}
SearchInput.filterSpec = searchSpec as unknown as (props: Record<string, unknown>) => FilterSpec

export interface ToggleProps {
  /** Binds `:<name>` as `1` (on) or `0` (off). */
  name: string
  label?: string
  default?: boolean
}

function toggleSpec(props: ToggleProps): FilterSpec {
  const fallback = props.default ? '1' : '0'
  return {
    key: props.name,
    default: fallback,
    params: (value) => ({
      [props.name]: value === '1' || value === 'true' ? 1 : 0,
    }),
  }
}

export function Toggle(props: ToggleProps) {
  const id = useId()
  const { values, set } = useFilters()
  const fallback = props.default ? '1' : '0'
  const raw = values[props.name] ?? fallback
  const checked = raw === '1' || raw === 'true'
  return (
    <label className="odd-filter odd-filter-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => set(props.name, event.target.checked ? '1' : '0')}
      />
      <span>{props.label ?? humanize(props.name)}</span>
    </label>
  )
}
Toggle.filterSpec = toggleSpec as unknown as (props: Record<string, unknown>) => FilterSpec

export interface MultiSelectProps {
  /**
   * Binds `:<name>` as a comma-separated list of selected values (e.g. `'North,South'`),
   * or `NULL` when "All" is selected.
   * Write `(:name IS NULL OR (',' || :name || ',') LIKE ('%,' || col || ',%'))` in SQL.
   */
  name: string
  label?: string
  /** A query whose first column is the value and optional second column the label. */
  query?: string
  options?: (string | { value: string; label: string })[]
  default?: string[] | string | null
  allLabel?: string
  /** Display mode: `'dropdown'` (compact menu with checkboxes, default) or `'chips'` (inline pill bar). */
  variant?: 'dropdown' | 'chips'
  /** Show a search input inside the dropdown popover. Defaults to true when there are more than 5 options. */
  searchable?: boolean
}

function normalizeMultiDefault(raw: MultiSelectProps['default']): string | null {
  if (Array.isArray(raw)) {
    const cleaned = raw.map((item) => String(item).trim()).filter(Boolean)
    return cleaned.length > 0 ? cleaned.join(',') : null
  }
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim()
  return null
}

function multiSelectSpec(props: MultiSelectProps): FilterSpec {
  const fallback = normalizeMultiDefault(props.default)
  return {
    key: props.name,
    default: fallback,
    params: (value) => ({ [props.name]: value && value.trim() !== '' ? value.trim() : null }),
  }
}

export function MultiSelect(props: MultiSelectProps) {
  const t = useT()
  const { values, set } = useFilters()
  const state = useQuery(props.query)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const fallback = normalizeMultiDefault(props.default)
  const raw = props.name in values ? values[props.name] : fallback
  const selected = raw
    ? raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []

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

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function toggleValue(optionValue: string) {
    const next = selected.includes(optionValue)
      ? selected.filter((item) => item !== optionValue)
      : [...selected, optionValue]
    set(props.name, next.length > 0 ? next.join(',') : null)
  }

  const variant = props.variant ?? 'dropdown'
  if (variant === 'chips') {
    return (
      <div className="odd-filter odd-filter-multiselect">
        <span>{props.label ?? humanize(props.name)}</span>
        <div className="odd-multiselect-chips">
          <button
            type="button"
            className="odd-multiselect-chip"
            data-active={selected.length === 0 || undefined}
            onClick={() => set(props.name, null)}
          >
            {props.allLabel ?? t('All')}
          </button>
          {options.map((option) => {
            const active = selected.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                className="odd-multiselect-chip"
                data-active={active || undefined}
                onClick={() => toggleValue(option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        {state.status === 'error' ? (
          <em className="odd-filter-error" title={state.error}>
            !
          </em>
        ) : null}
      </div>
    )
  }

  const labelByValue = new Map(options.map((o) => [o.value, o.label]))
  const selectedLabels = selected.map((v) => labelByValue.get(v) ?? v)
  const allText = props.allLabel ?? t('All')
  const summaryText =
    selectedLabels.length === 0
      ? allText
      : selectedLabels.length <= 2
        ? selectedLabels.join(', ')
        : `${selectedLabels.slice(0, 2).join(', ')} +${selectedLabels.length - 2}`

  const showSearch = props.searchable ?? options.length > 5
  const needle = search.trim().toLowerCase()
  const filteredOptions = needle
    ? options.filter(
        (o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle),
      )
    : options

  return (
    <div className="odd-filter odd-filter-multiselect" ref={rootRef}>
      <span>{props.label ?? humanize(props.name)}</span>
      <div className="odd-multiselect-dropdown">
        <button
          type="button"
          className="odd-multiselect-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          data-active={selected.length > 0 || undefined}
          title={selectedLabels.length > 0 ? selectedLabels.join('、') : allText}
          onClick={() => {
            setOpen((prev) => {
              if (prev) setSearch('')
              return !prev
            })
          }}
        >
          <span className="odd-multiselect-summary">{summaryText}</span>
          {selected.length > 0 ? (
            <span className="odd-multiselect-badge">{selected.length}</span>
          ) : null}
        </button>
        {open ? (
          <div
            className="odd-multiselect-popover"
            role="listbox"
            aria-multiselectable="true"
            data-export-skip=""
          >
            {showSearch ? (
              <div className="odd-multiselect-search-wrap">
                <input
                  type="search"
                  className="odd-multiselect-search"
                  value={search}
                  placeholder={t('Filter…')}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            ) : null}
            <div className="odd-multiselect-list">
              <button
                type="button"
                role="option"
                aria-selected={selected.length === 0}
                className="odd-multiselect-option odd-multiselect-option-all"
                data-active={selected.length === 0 || undefined}
                onClick={() => set(props.name, null)}
              >
                <span
                  className="odd-multiselect-check"
                  data-checked={selected.length === 0 || undefined}
                >
                  {selected.length === 0 ? '✓' : ''}
                </span>
                <span className="odd-multiselect-option-label">{allText}</span>
                {selected.length > 0 ? (
                  <span className="odd-multiselect-clear-hint">↺ {t('Reset')}</span>
                ) : null}
              </button>
              {filteredOptions.map((option) => {
                const active = selected.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className="odd-multiselect-option"
                    data-active={active || undefined}
                    onClick={() => toggleValue(option.value)}
                  >
                    <span className="odd-multiselect-check" data-checked={active || undefined}>
                      {active ? '✓' : ''}
                    </span>
                    <span className="odd-multiselect-option-label">{option.label}</span>
                  </button>
                )
              })}
              {filteredOptions.length === 0 ? (
                <div className="odd-multiselect-empty">{t('No data')}</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {state.status === 'error' ? (
        <em className="odd-filter-error" title={state.error}>
          !
        </em>
      ) : null}
    </div>
  )
}
MultiSelect.filterSpec = multiSelectSpec as unknown as (
  props: Record<string, unknown>,
) => FilterSpec

export interface NumberRangeProps {
  /** Binds `:<name>_min` and `:<name>_max` as numbers (or `NULL` when blank). */
  name: string
  label?: string
  min?: number
  max?: number
  step?: number
  defaultMin?: number | null
  defaultMax?: number | null
}

function formatNumberRangeBound(min?: number | null, max?: number | null): string | null {
  const hasMin = typeof min === 'number' && Number.isFinite(min)
  const hasMax = typeof max === 'number' && Number.isFinite(max)
  if (!hasMin && !hasMax) return null
  return `${hasMin ? min : ''}..${hasMax ? max : ''}`
}

export function parseNumberRangeValue(raw: string | null | undefined): {
  min: number | null
  max: number | null
} {
  if (!raw || !raw.includes('..')) return { min: null, max: null }
  const [left = '', right = ''] = raw.split('..', 2)
  const min = left.trim() !== '' && Number.isFinite(Number(left)) ? Number(left) : null
  const max = right.trim() !== '' && Number.isFinite(Number(right)) ? Number(right) : null
  if (min !== null && max !== null && min > max) return { min: max, max: min }
  return { min, max }
}

function numberRangeSpec(props: NumberRangeProps): FilterSpec {
  const fallback = formatNumberRangeBound(props.defaultMin, props.defaultMax)
  return {
    key: props.name,
    default: fallback,
    params: (value) => {
      const parsed = parseNumberRangeValue(value ?? fallback)
      return {
        [`${props.name}_min`]: parsed.min,
        [`${props.name}_max`]: parsed.max,
      }
    },
  }
}

export function NumberRange(props: NumberRangeProps) {
  const minId = useId()
  const maxId = useId()
  const { values, set } = useFilters()
  const fallback = formatNumberRangeBound(props.defaultMin, props.defaultMax)
  const raw = props.name in values ? values[props.name] : fallback
  const parsed = parseNumberRangeValue(raw)

  const update = (nextMin: string, nextMax: string) => {
    const cleanMin = nextMin.trim()
    const cleanMax = nextMax.trim()
    if (!cleanMin && !cleanMax) {
      set(props.name, null)
      return
    }
    set(props.name, `${cleanMin}..${cleanMax}`)
  }

  return (
    <div className="odd-filter odd-filter-number-range">
      <span>{props.label ?? humanize(props.name)}</span>
      <div className="odd-number-range-inputs">
        <input
          id={minId}
          type="number"
          aria-label={`${props.label ?? humanize(props.name)} min`}
          placeholder={props.min !== undefined ? String(props.min) : 'Min'}
          min={props.min}
          max={props.max}
          step={props.step ?? 'any'}
          value={parsed.min ?? ''}
          onChange={(e) => update(e.target.value, parsed.max !== null ? String(parsed.max) : '')}
        />
        <span aria-hidden="true">–</span>
        <input
          id={maxId}
          type="number"
          aria-label={`${props.label ?? humanize(props.name)} max`}
          placeholder={props.max !== undefined ? String(props.max) : 'Max'}
          min={props.min}
          max={props.max}
          step={props.step ?? 'any'}
          value={parsed.max ?? ''}
          onChange={(e) => update(parsed.min !== null ? String(parsed.min) : '', e.target.value)}
        />
      </div>
    </div>
  )
}
NumberRange.filterSpec = numberRangeSpec as unknown as (
  props: Record<string, unknown>,
) => FilterSpec
