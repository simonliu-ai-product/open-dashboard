import type { ReactNode } from 'react'
import type { ColumnInfo } from '../../config.js'
import { TYPE_LABELS } from '../../runtime/catalog.js'
import { applyProps, isPanelType, PANEL_PROPS, type PropValue } from '../../runtime/convert.js'
import { useEdit } from '../../runtime/edit.js'
import { useT } from '../../runtime/i18n.js'
import { CHART_GROUPS, CHART_ICONS } from './chart-icons.js'
import { PencilIcon } from './icons.js'

type Kind = 'any' | 'number' | 'category'

interface Field {
  key: string
  label: string
  kind: Kind
  /** May be left empty: the chart then picks a column itself, or does without. */
  optional?: boolean
}

/**
 * The column pickers each chart type shows. XY charts (line, area, bar) have
 * their own block — several y columns, series, stacking — and are not listed.
 */
export const FIELDS: Record<string, Field[]> = {
  PieChart: [
    { key: 'label', label: 'Slices (label)', kind: 'any', optional: true },
    { key: 'value', label: 'Size (value)', kind: 'number', optional: true },
  ],
  Treemap: [
    { key: 'label', label: 'Slices (label)', kind: 'any', optional: true },
    { key: 'value', label: 'Size (value)', kind: 'number', optional: true },
    { key: 'group', label: 'Colour by', kind: 'category', optional: true },
  ],
  FunnelChart: [
    { key: 'label', label: 'Stages (label)', kind: 'any', optional: true },
    { key: 'value', label: 'Size (value)', kind: 'number', optional: true },
  ],
  Stat: [{ key: 'column', label: 'Value', kind: 'number', optional: true }],
  Gauge: [{ key: 'column', label: 'Value', kind: 'number', optional: true }],
  ScatterChart: [
    { key: 'x', label: 'Across (x)', kind: 'number' },
    { key: 'y', label: 'Up (y)', kind: 'number' },
    { key: 'series', label: 'Colour by (series)', kind: 'category', optional: true },
    { key: 'size', label: 'Bubble size', kind: 'number', optional: true },
  ],
  Heatmap: [
    { key: 'x', label: 'Columns (x)', kind: 'any' },
    { key: 'y', label: 'Rows (y)', kind: 'any' },
    { key: 'value', label: 'Colour (value)', kind: 'number' },
  ],
  DotPlot: [
    { key: 'label', label: 'Rows (label)', kind: 'any', optional: true },
    { key: 'value', label: 'Value', kind: 'number', optional: true },
  ],
  Dumbbell: [
    { key: 'label', label: 'Rows (label)', kind: 'any', optional: true },
    { key: 'from', label: 'From', kind: 'number' },
    { key: 'to', label: 'To', kind: 'number' },
  ],
  BulletChart: [
    { key: 'label', label: 'Rows (label)', kind: 'any', optional: true },
    { key: 'value', label: 'Value', kind: 'number', optional: true },
    { key: 'target', label: 'Target', kind: 'number', optional: true },
  ],
  DivergingBar: [
    { key: 'label', label: 'Rows (label)', kind: 'any', optional: true },
    { key: 'value', label: 'Value', kind: 'number', optional: true },
  ],
  Marimekko: [
    { key: 'x', label: 'Columns (x)', kind: 'any' },
    { key: 'series', label: 'Segments (series)', kind: 'category' },
    { key: 'value', label: 'Size (value)', kind: 'number' },
  ],
  SlopeChart: [
    { key: 'label', label: 'Rows (label)', kind: 'any', optional: true },
    { key: 'from', label: 'From', kind: 'number' },
    { key: 'to', label: 'To', kind: 'number' },
  ],
  BumpChart: [
    { key: 'x', label: 'Across (x)', kind: 'any' },
    { key: 'series', label: 'Ranked (series)', kind: 'category' },
    { key: 'value', label: 'Ranked by (value)', kind: 'number' },
  ],
}

Object.assign(FIELDS, {
  Waterfall: [
    { key: 'label', label: 'Steps (label)', kind: 'any', optional: true },
    { key: 'value', label: 'Change (value)', kind: 'number', optional: true },
    { key: 'type', label: 'Total marker (type)', kind: 'category', optional: true },
  ],
  CalendarHeatmap: [
    { key: 'x', label: 'Date', kind: 'any' },
    { key: 'value', label: 'Colour (value)', kind: 'number', optional: true },
  ],
  SmallMultiples: [
    { key: 'x', label: 'Across (x)', kind: 'any' },
    { key: 'y', label: 'Up (y)', kind: 'number' },
    { key: 'series', label: 'One chart per (series)', kind: 'category' },
  ],
  BandChart: [
    { key: 'x', label: 'Across (x)', kind: 'any' },
    { key: 'y', label: 'Line (y)', kind: 'number' },
    { key: 'low', label: 'Band low', kind: 'number' },
    { key: 'high', label: 'Band high', kind: 'number' },
    { key: 'low2', label: 'Outer band low', kind: 'number', optional: true },
    { key: 'high2', label: 'Outer band high', kind: 'number', optional: true },
  ],
  ControlChart: [
    { key: 'x', label: 'Across (x)', kind: 'any' },
    { key: 'y', label: 'Measure (y)', kind: 'number' },
    { key: 'center', label: 'Centre line', kind: 'number', optional: true },
    { key: 'upper', label: 'Upper limit', kind: 'number', optional: true },
    { key: 'lower', label: 'Lower limit', kind: 'number', optional: true },
  ],
  HorizonChart: [
    { key: 'x', label: 'Across (x)', kind: 'any' },
    { key: 'series', label: 'One row per (series)', kind: 'category' },
    { key: 'y', label: 'Measure (y)', kind: 'number' },
  ],
  Timeline: [
    { key: 'label', label: 'Lanes (label)', kind: 'any' },
    { key: 'start', label: 'Start', kind: 'any' },
    { key: 'end', label: 'End', kind: 'any' },
    { key: 'series', label: 'Colour by (series)', kind: 'category', optional: true },
  ],
  Gantt: [
    { key: 'label', label: 'Task (label)', kind: 'any' },
    { key: 'start', label: 'Start', kind: 'any' },
    { key: 'end', label: 'End', kind: 'any' },
    { key: 'group', label: 'Phase (group)', kind: 'category', optional: true },
    { key: 'after', label: 'Depends on (after)', kind: 'any', optional: true },
    { key: 'progress', label: 'Done (progress)', kind: 'number', optional: true },
    { key: 'series', label: 'Colour by (series)', kind: 'category', optional: true },
  ],
  Candlestick: [
    { key: 'x', label: 'Date', kind: 'any' },
    { key: 'open', label: 'Open', kind: 'number' },
    { key: 'high', label: 'High', kind: 'number' },
    { key: 'low', label: 'Low', kind: 'number' },
    { key: 'close', label: 'Close', kind: 'number' },
  ],
} satisfies Record<string, Field[]>)

Object.assign(FIELDS, {
  ChoroplethMap: [
    { key: 'region', label: 'Region (matches the map)', kind: 'any' },
    { key: 'value', label: 'Colour (value)', kind: 'number' },
  ],
  SymbolMap: [
    { key: 'lat', label: 'Latitude', kind: 'number' },
    { key: 'lng', label: 'Longitude', kind: 'number' },
    { key: 'size', label: 'Bubble size', kind: 'number', optional: true },
    { key: 'label', label: 'Name (label)', kind: 'any', optional: true },
    { key: 'series', label: 'Colour by (series)', kind: 'category', optional: true },
  ],
  TileMap: [
    { key: 'region', label: 'Region (matches the map)', kind: 'any' },
    { key: 'value', label: 'Colour (value)', kind: 'number' },
  ],
  StateTimeline: [
    { key: 'x', label: 'Time', kind: 'any' },
    { key: 'series', label: 'One row per (series)', kind: 'category' },
    { key: 'state', label: 'State', kind: 'category' },
  ],
  PivotTable: [
    { key: 'rows', label: 'Rows', kind: 'category' },
    { key: 'columns', label: 'Columns', kind: 'any' },
    { key: 'value', label: 'Value', kind: 'number' },
  ],
} satisfies Record<string, Field[]>)

Object.assign(FIELDS, {
  Histogram: [{ key: 'value', label: 'Value', kind: 'number', optional: true }],
  BoxPlot: [
    { key: 'value', label: 'Value', kind: 'number', optional: true },
    { key: 'label', label: 'One box per (label)', kind: 'category', optional: true },
  ],
  StripPlot: [
    { key: 'value', label: 'Value', kind: 'number' },
    { key: 'label', label: 'One row per (label)', kind: 'category', optional: true },
  ],
  EcdfChart: [
    { key: 'value', label: 'Value', kind: 'number' },
    { key: 'series', label: 'One line per (series)', kind: 'category', optional: true },
  ],
  ParetoChart: [
    { key: 'label', label: 'Entities (label)', kind: 'any', optional: true },
    { key: 'value', label: 'Value', kind: 'number', optional: true },
  ],
  Sankey: [
    { key: 'source', label: 'From (source)', kind: 'category' },
    { key: 'target', label: 'To (target)', kind: 'category' },
    { key: 'value', label: 'Flow (value)', kind: 'number' },
  ],
  CohortTable: [
    { key: 'cohort', label: 'Cohort', kind: 'any' },
    { key: 'period', label: 'Period', kind: 'number' },
    { key: 'value', label: 'Value', kind: 'number' },
    { key: 'size', label: 'Cohort size', kind: 'number', optional: true },
  ],
  UpSetChart: [
    { key: 'sets', label: 'Sets (comma-separated)', kind: 'category' },
    { key: 'value', label: 'Count (value)', kind: 'number' },
  ],
} satisfies Record<string, Field[]>)

/** Switches each chart type offers. */
export const TOGGLES: Record<string, { key: string; label: string }[]> = {
  LineChart: [
    { key: 'stacked', label: 'Stacked' },
    { key: 'area', label: 'Fill under lines' },
  ],
  AreaChart: [{ key: 'stacked', label: 'Stacked' }],
  BarChart: [
    { key: 'stacked', label: 'Stacked' },
    { key: 'horizontal', label: 'Horizontal bars' },
  ],
  Stat: [{ key: 'invert', label: 'Lower is better' }],
  DotPlot: [{ key: 'zero', label: 'Start the axis at zero' }],
  Dumbbell: [{ key: 'zero', label: 'Start the axis at zero' }],
  SlopeChart: [{ key: 'zero', label: 'Start the axis at zero' }],
  DivergingBar: [{ key: 'invert', label: 'Lower is better' }],
  BumpChart: [{ key: 'ascending', label: 'Lowest value ranks first' }],
  SmallMultiples: [{ key: 'independent', label: 'Separate scale per chart' }],
  Timeline: [{ key: 'now', label: 'Mark the current time' }],
  Gantt: [{ key: 'now', label: 'Mark the current time' }],
  PivotTable: [
    { key: 'totals', label: 'Totals' },
    { key: 'heat', label: 'Shade cells by value' },
  ],
}

const XY_TYPES = new Set(['LineChart', 'AreaChart', 'BarChart'])

/** Optional pickers whose empty choice means "without", not "pick one for me". */
const NONE_KEYS = new Set([
  'series',
  'group',
  'size',
  'target',
  'type',
  'low2',
  'high2',
  'center',
  'upper',
  'lower',
  'after',
  'progress',
])

const FORMATS = [
  'number',
  'integer',
  'decimal',
  'compact',
  'currency',
  'currencyCompact',
  'percent',
  'date',
  'month',
  'text',
]
const FORMAT_LABELS: Record<string, string> = {
  number: 'Number',
  integer: 'Whole number',
  decimal: 'Two decimals',
  compact: 'Compact (1.2K)',
  currency: 'Currency',
  currencyCompact: 'Currency, compact',
  percent: 'Percent',
  date: 'Date',
  month: 'Month',
  text: 'Text as is',
}

function asList(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * The chart behind a panel, as controls. Every change is staged through the
 * same edit queue as a drag, previewed at once, and written only on Save.
 */
export function ChartSettings({ title, columns }: { title: string; columns: ColumnInfo[] }) {
  const t = useT()
  const edit = useEdit()
  const source = edit.layout[title]
  if (!edit.editing) {
    return (
      <button type="button" className="odd-button odd-chart-settings-edit" onClick={edit.enterEdit}>
        <PencilIcon />
        {t('Edit')}
      </button>
    )
  }
  if (!source) {
    return (
      <p className="odd-muted">
        {t('This panel cannot be edited here: its title is computed or not unique.')}
      </p>
    )
  }
  const staged = edit.panels[title]
  const component = staged?.component ?? source.component
  const props = applyProps(source.props, staged?.changes ?? {})
  const locked = new Set(source.locked)
  const supported = new Set(isPanelType(component) ? PANEL_PROPS[component] : PANEL_PROPS.Text)
  const disabled = !edit.editing
  const numeric = columns.filter((c) => c.type === 'number').map((c) => c.name)
  const all = columns.map((c) => c.name)

  const set = (key: string, value: PropValue) =>
    edit.stage({ kind: 'props', title, set: { [key]: value } })
  const lock = (key: string) => disabled || locked.has(key)
  const lockedNote = (key: string) =>
    locked.has(key) ? <em className="odd-field-note">{t('Set in code')}</em> : null

  const columnSelect = (key: string, label: string, options: string[], allowNone: boolean) => (
    <label className="odd-field" key={key}>
      <span>
        {t(label)}
        {lockedNote(key)}
      </span>
      <select
        value={typeof props[key] === 'string' ? (props[key] as string) : ''}
        disabled={lock(key)}
        onChange={(event) => set(key, event.target.value || null)}
      >
        {allowNone ? (
          <option value="">{NONE_KEYS.has(key) ? t('None') : t('Automatic')}</option>
        ) : null}
        {typeof props[key] === 'string' && !options.includes(props[key] as string) ? (
          <option value={props[key] as string}>{props[key] as string}</option>
        ) : null}
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )

  const toggle = (key: string, label: string) => (
    <label className="odd-check" key={key}>
      <input
        type="checkbox"
        checked={props[key] === true}
        disabled={lock(key)}
        onChange={(event) => set(key, event.target.checked || null)}
      />
      <span>{t(label)}</span>
      {lockedNote(key)}
    </label>
  )

  const ys = asList(props.y)

  return (
    <div className="odd-chart-settings" aria-disabled={disabled}>
      {disabled ? (
        <button
          type="button"
          className="odd-button odd-chart-settings-edit"
          onClick={edit.enterEdit}
        >
          <PencilIcon />
          {t('Edit')}
        </button>
      ) : null}

      {isPanelType(component) ? (
        <fieldset className="odd-field odd-types" disabled={disabled}>
          <legend>{t('Chart type')}</legend>
          {CHART_GROUPS.map((group) => {
            const types = group.types.filter(isPanelType)
            if (types.length === 0) return null
            return (
              <div key={group.label} className="odd-type-group">
                <span className="odd-type-group-label">{t(group.label)}</span>
                <div className="odd-type-grid">
                  {types.map((type) => {
                    const Icon = CHART_ICONS[type]
                    return (
                      <label key={type} className="odd-type">
                        <input
                          type="radio"
                          name={`type-${title}`}
                          checked={component === type}
                          onChange={() => edit.stage({ kind: 'component', title, component: type })}
                        />
                        {Icon ? <Icon /> : null}
                        <span>{t(TYPE_LABELS[type] ?? type)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </fieldset>
      ) : null}

      {XY_TYPES.has(component) ? (
        <>
          {columnSelect('x', 'Category (x)', all, true)}
          <fieldset className="odd-field" disabled={lock('y')}>
            <legend>
              {t('Values (y)')}
              {lockedNote('y')}
            </legend>
            {numeric.map((name) => (
              <label key={name} className="odd-check">
                <input
                  type="checkbox"
                  checked={ys.length === 0 || ys.includes(name)}
                  onChange={(event) => {
                    const current = ys.length === 0 ? numeric : ys
                    const next = event.target.checked
                      ? [...current, name]
                      : current.filter((n) => n !== name)
                    const ordered = numeric.filter((n) => next.includes(n))
                    set(
                      'y',
                      ordered.length === 0
                        ? null
                        : ordered.length === 1
                          ? (ordered[0] as string)
                          : ordered,
                    )
                  }}
                />
                <span>{name}</span>
              </label>
            ))}
          </fieldset>
          {columnSelect(
            'series',
            'Split by (series)',
            all.filter((n) => !numeric.includes(n)),
            true,
          )}
        </>
      ) : null}

      {(FIELDS[component] ?? []).map((field) =>
        columnSelect(
          field.key,
          field.label,
          field.kind === 'number'
            ? numeric
            : field.kind === 'category'
              ? all.filter((n) => !numeric.includes(n))
              : all,
          field.optional === true,
        ),
      )}

      {(TOGGLES[component] ?? []).length > 0 ? (
        <div className="odd-checks">
          {(TOGGLES[component] ?? []).map((item) => toggle(item.key, item.label))}
        </div>
      ) : null}

      {supported.has('format') ? (
        <label className="odd-field">
          <span>
            {t('Format')}
            {lockedNote('format')}
          </span>
          <select
            value={typeof props.format === 'string' ? props.format : ''}
            disabled={lock('format')}
            onChange={(event) => set('format', event.target.value || null)}
          >
            <option value="">{t('Automatic')}</option>
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {t(FORMAT_LABELS[f] as string)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {supported.has('drill') ? (
        <label className="odd-field">
          <span>
            {t('Click to filter')}
            {lockedNote('drill')}
          </span>
          <select
            value={typeof props.drill === 'string' ? props.drill : ''}
            disabled={lock('drill') || edit.filters.length === 0}
            onChange={(event) => set('drill', event.target.value || null)}
          >
            <option value="">
              {edit.filters.length ? t('Off') : t('No filters on this dashboard')}
            </option>
            {edit.filters.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="odd-field-row">
        <NumberField
          label={t('Width (of 12)')}
          note={lockedNote('span')}
          value={typeof props.span === 'number' ? props.span : undefined}
          min={1}
          max={12}
          step={1}
          placeholder={t('Auto')}
          disabled={lock('span')}
          onCommit={(n) => set('span', n)}
        />
        <NumberField
          label={t('Height (px)')}
          note={lockedNote('height')}
          value={typeof props.height === 'number' ? props.height : undefined}
          min={80}
          max={1600}
          step={10}
          placeholder={t('Auto')}
          disabled={lock('height')}
          onCommit={(n) => set('height', n)}
        />
      </div>
    </div>
  )
}

/** Typed freely, committed on Enter or blur, clamped to range — never staged half-typed. */
function NumberField(props: {
  label: string
  note: ReactNode
  value: number | undefined
  min: number
  max: number
  step: number
  placeholder: string
  disabled: boolean
  onCommit: (value: number | null) => void
}) {
  const commit = (raw: string) => {
    if (raw.trim() === '') {
      if (props.value !== undefined) props.onCommit(null)
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const next = Math.min(props.max, Math.max(props.min, Math.round(n / props.step) * props.step))
    if (next !== props.value) props.onCommit(next)
  }
  return (
    <label className="odd-field">
      <span>
        {props.label}
        {props.note}
      </span>
      <input
        key={props.value ?? 'auto'}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        defaultValue={props.value ?? ''}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget.value)
        }}
      />
    </label>
  )
}
