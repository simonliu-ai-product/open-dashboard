import { useEffect, useMemo, useState } from 'react'
import type { ColumnInfo } from '../config.js'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext } from './panel.js'

export type TableSummaryKind = 'sum' | 'avg' | 'min' | 'max' | 'count'

export interface TableColumn {
  key: string
  label?: string
  format?: Format
  align?: 'left' | 'right' | 'center'
  /** Draw an inline bar proportional to the column's largest value. */
  bar?: boolean
  /** Render string values as status pills. */
  badge?: boolean
  /** Render a comma-separated list or JSON array of numbers as an inline mini sparkline. */
  sparkline?: boolean
  /** Shade numeric cells along a subtle heatmap color scale from min to max. */
  colorScale?: boolean
  /** Format numeric values as positive/negative deltas with ▲ / ▼ arrows and signal colours. */
  delta?: boolean
  /** Render cell as a link by interpolating `{value}` and `{column}` placeholders from the row. */
  href?: string
  /** Aggregate shown in the footer row for this column. */
  summary?: TableSummaryKind
}

export interface TableProps extends PanelProps {
  query: string
  /** Which columns, in which order. Default: all of them. */
  columns?: (string | TableColumn)[]
  /** Formats by column name, for when `columns` is not given. */
  format?: Record<string, Format>
  /** Initial sort: a column name, prefix "-" for descending. Default: the query's order. */
  sort?: string
  /** Show an instant search box above the table. */
  searchable?: boolean
  /** Paginate rows when more than `pageSize` exist. */
  pageSize?: number
  /** Show a summary footer row (`true` defaults numeric columns to `'sum'`). */
  summary?: boolean | TableSummaryKind
  /** Open a slide-over detail drawer when a row is clicked to inspect all fields and copy JSON. */
  detail?: boolean
}

const IDENTIFIER = /(^id$|_id$|^id_)/i
const ID_FORMAT = { useGrouping: false, maximumFractionDigits: 0 } as const

function interpolateHref(template: string, value: unknown, row: Record<string, unknown>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, key: string) => {
    const raw = key === 'value' ? value : row[key]
    return raw === null || raw === undefined ? '' : encodeURIComponent(String(raw))
  })
}

function parseSparkPoints(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) return parsed.map(Number).filter(Number.isFinite)
      } catch {
        // fall through to comma split
      }
    }
    return trimmed
      .split(',')
      .map((s) => Number(s.trim()))
      .filter(Number.isFinite)
  }
  return []
}

function CellSparkline({ value }: { value: unknown }) {
  const nums = parseSparkPoints(value)
  if (nums.length < 2) return <span>{String(value ?? '—')}</span>
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const w = 72
  const h = 20
  const points = nums.map((v, i): [number, number] => [
    2 + (i / (nums.length - 1)) * (w - 4),
    2 + (h - 4) - (max === min ? (h - 4) / 2 : ((v - min) / (max - min)) * (h - 4)),
  ])
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const last = points[points.length - 1]
  return (
    <svg className="odd-cell-spark" width={w} height={h} aria-hidden="true">
      <path d={d} className="odd-spark-line" />
      {last ? <circle cx={last[0]} cy={last[1]} r={2.2} className="odd-spark-dot" /> : null}
    </svg>
  )
}

function badgeTone(value: unknown): 'good' | 'bad' | 'neutral' {
  const s = String(value ?? '').toLowerCase()
  if (/^(ok|healthy|active|paid|completed|delivered|online|up|pass|passed|good|low)$/.test(s))
    return 'good'
  if (/^(error|failed|critical|down|overdue|cancelled|canceled|refunded|high|bad|alert)$/.test(s))
    return 'bad'
  return 'neutral'
}

function computeSummary(values: number[], kind: TableSummaryKind): number | null {
  if (kind === 'count') return values.length
  if (values.length === 0) return null
  const sum = values.reduce((a, b) => a + b, 0)
  if (kind === 'sum') return sum
  if (kind === 'avg') return sum / values.length
  if (kind === 'min') return Math.min(...values)
  return Math.max(...values)
}

function DataTable({ run, props }: { run: QueryRun; props: TableProps }) {
  const t = useT()
  const drill = useDrill(props.drill, props.drillTo)
  const ctx = useFormatContext()
  const [sort, setSort] = useState<string | undefined>(props.sort)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [detailRow, setDetailRow] = useState<Record<string, unknown> | null>(null)
  const [copiedJson, setCopiedJson] = useState(false)
  const types = new Map<string, ColumnInfo['type']>(run.result.columns.map((c) => [c.name, c.type]))
  const columns: TableColumn[] = (props.columns ?? run.result.columns.map((c) => c.name)).map(
    (column) => (typeof column === 'string' ? { key: column } : column),
  )

  useEffect(() => {
    if (!detailRow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailRow(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detailRow])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return run.result.rows
    return run.result.rows.filter((row) =>
      columns.some((col) =>
        String(row[col.key] ?? '')
          .toLowerCase()
          .includes(q),
      ),
    )
  }, [run.result.rows, columns, query])

  const rows = useMemo(() => {
    if (!sort) return filtered
    const desc = sort.startsWith('-')
    const key = desc ? sort.slice(1) : sort
    return [...filtered].sort((a, b) => {
      const x = a[key]
      const y = b[key]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      const order =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return desc ? -order : order
    })
  }, [filtered, sort])

  const maxima = new Map<string, number>()
  const scales = new Map<string, { min: number; max: number }>()
  for (const column of columns) {
    const nums = run.result.rows.map((r) => Number(r[column.key])).filter(Number.isFinite)
    if (column.bar) {
      maxima.set(column.key, Math.max(0, ...nums))
    }
    if (column.colorScale && nums.length > 0) {
      scales.set(column.key, { min: Math.min(...nums), max: Math.max(...nums) })
    }
  }

  const pageSize = props.pageSize && props.pageSize > 0 ? props.pageSize : 1000
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pageCount - 1)
  const visibleRows = rows.slice(safePage * pageSize, (safePage + 1) * pageSize)
  const hasSummary = Boolean(props.summary) || columns.some((c) => c.summary !== undefined)
  const defaultSummary: TableSummaryKind | undefined =
    props.summary === true ? 'sum' : typeof props.summary === 'string' ? props.summary : undefined

  return (
    <div className="odd-table-wrap">
      {props.searchable ? (
        <div className="odd-table-toolbar" data-export-skip="">
          <input
            type="search"
            className="odd-table-search"
            value={query}
            placeholder={t('Filter…')}
            aria-label={t('Filter…')}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
          />
          <span className="odd-muted">{t('{n} rows', { n: rows.length.toLocaleString() })}</span>
        </div>
      ) : null}
      <table className="odd-table">
        <thead>
          <tr>
            {columns.map((column) => {
              const numeric = types.get(column.key) === 'number'
              const active =
                sort === column.key
                  ? 'ascending'
                  : sort === `-${column.key}`
                    ? 'descending'
                    : undefined
              return (
                <th
                  key={column.key}
                  style={{ textAlign: column.align ?? (numeric ? 'right' : 'left') }}
                  aria-sort={active ?? 'none'}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setSort(
                        sort === `-${column.key}`
                          ? column.key
                          : sort === column.key
                            ? undefined
                            : `-${column.key}`,
                      )
                    }
                  >
                    {column.label ?? humanize(column.key)}
                    <span className="odd-sort" aria-hidden="true">
                      {active === 'ascending' ? '↑' : active === 'descending' ? '↓' : ''}
                    </span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, i) => {
            const interactive = Boolean(drill || props.detail)
            const handleRowActivate = () => {
              if (drill) drill.pick(row[drill.column ?? drill.filter])
              if (props.detail) {
                setCopiedJson(false)
                setDetailRow(row)
              }
            }
            return (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
                key={i}
                data-active={
                  drill?.isActive(row[drill.column ?? drill.filter]) ||
                  detailRow === row ||
                  undefined
                }
                tabIndex={interactive ? 0 : undefined}
                onClick={interactive ? handleRowActivate : undefined}
                onKeyDown={
                  interactive
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleRowActivate()
                        }
                      }
                    : undefined
                }
                className={interactive ? 'odd-drillable' : undefined}
              >
                {columns.map((column) => {
                  const numeric = types.get(column.key) === 'number'
                  const value = row[column.key]
                  const max = maxima.get(column.key)
                  const scale = scales.get(column.key)
                  const numVal = Number(value)
                  const scalePct =
                    scale && Number.isFinite(numVal)
                      ? scale.max === scale.min
                        ? 14
                        : Math.round(4 + ((numVal - scale.min) / (scale.max - scale.min)) * 22)
                      : 0
                  const colFormat =
                    column.format ??
                    props.format?.[column.key] ??
                    (IDENTIFIER.test(column.key) ? ID_FORMAT : undefined)
                  const formatted = formatValue(value, colFormat, ctx)
                  const inner = column.sparkline ? (
                    <CellSparkline value={value} />
                  ) : column.badge && value !== null && value !== undefined ? (
                    <span className="odd-cell-badge" data-tone={badgeTone(value)}>
                      {formatted}
                    </span>
                  ) : column.delta && Number.isFinite(numVal) && value !== null ? (
                    <span
                      className="odd-cell-delta"
                      data-tone={numVal > 0 ? 'good' : numVal < 0 ? 'bad' : 'neutral'}
                    >
                      {numVal > 0 ? '▲ ' : numVal < 0 ? '▼ ' : ''}
                      {formatted}
                    </span>
                  ) : (
                    formatted
                  )
                  return (
                    <td
                      key={column.key}
                      style={{
                        textAlign: column.align ?? (numeric ? 'right' : 'left'),
                        background:
                          scalePct > 0
                            ? `color-mix(in srgb, var(--odd-accent) ${scalePct}%, transparent)`
                            : undefined,
                      }}
                      data-numeric={numeric || undefined}
                    >
                      {max ? (
                        <span className="odd-cell-bar">
                          <span style={{ width: `${Math.max(0, (Number(value) / max) * 100)}%` }} />
                        </span>
                      ) : null}
                      {column.href && value !== null && value !== undefined ? (
                        <a
                          href={interpolateHref(column.href, value, row)}
                          className="odd-cell-link"
                          target={column.href.startsWith('http') ? '_blank' : undefined}
                          rel={column.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {inner}
                        </a>
                      ) : (
                        inner
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        {hasSummary && rows.length > 0 ? (
          <tfoot>
            <tr className="odd-table-summary">
              {columns.map((column, colIdx) => {
                const numeric = types.get(column.key) === 'number' && !IDENTIFIER.test(column.key)
                const kind = column.summary ?? (numeric ? defaultSummary : undefined)
                if (!kind) {
                  return (
                    <td key={column.key}>{colIdx === 0 ? <strong>{t('Total')}</strong> : ''}</td>
                  )
                }
                const nums = rows
                  .map((r) => Number(r[column.key]))
                  .filter((v) => Number.isFinite(v))
                const agg = computeSummary(nums, kind)
                const colFormat =
                  kind === 'count'
                    ? 'integer'
                    : (column.format ?? props.format?.[column.key] ?? undefined)
                return (
                  <td
                    key={column.key}
                    style={{ textAlign: column.align ?? (numeric ? 'right' : 'left') }}
                    data-numeric={numeric || undefined}
                  >
                    <strong>{agg === null ? '—' : formatValue(agg, colFormat, ctx)}</strong>
                  </td>
                )
              })}
            </tr>
          </tfoot>
        ) : null}
      </table>
      {props.pageSize && pageCount > 1 ? (
        <div className="odd-table-pager" data-export-skip="">
          <button
            type="button"
            className="odd-icon-button"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label={t('Previous')}
          >
            ←
          </button>
          <span className="odd-muted">
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="odd-icon-button"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            aria-label={t('Next')}
          >
            →
          </button>
        </div>
      ) : null}
      {rows.length > 1000 && !props.pageSize ? (
        <p className="odd-table-note">
          {t('Showing the first {n} rows. Aggregate in SQL for the rest.', {
            n: Math.min(rows.length, 1000).toLocaleString(),
          })}
        </p>
      ) : null}
      {detailRow ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Escape key handled via window listener
        <div
          className="odd-row-drawer-backdrop"
          data-export-skip=""
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetailRow(null)
          }}
        >
          <aside className="odd-row-drawer" aria-label={t('Row details')}>
            <header className="odd-row-drawer-head">
              <strong>
                {props.title ? `${props.title} — ${t('Row details')}` : t('Row details')}
              </strong>
              <div className="odd-row-drawer-actions">
                <button
                  type="button"
                  className="odd-chip-btn"
                  onClick={() => {
                    navigator.clipboard?.writeText(JSON.stringify(detailRow, null, 2))
                    setCopiedJson(true)
                  }}
                >
                  {copiedJson ? t('Copied') : t('Copy JSON')}
                </button>
                <button
                  type="button"
                  className="odd-icon-button"
                  aria-label={t('Close')}
                  onClick={() => setDetailRow(null)}
                >
                  ×
                </button>
              </div>
            </header>
            <dl className="odd-row-drawer-list">
              {run.result.columns.map((col) => {
                const rawVal = detailRow[col.name]
                const colSpec = columns.find((c) => c.key === col.name)
                const colFormat =
                  colSpec?.format ??
                  props.format?.[col.name] ??
                  (IDENTIFIER.test(col.name) ? ID_FORMAT : undefined)
                const formatted = formatValue(rawVal, colFormat, ctx)
                return (
                  <div key={col.name} className="odd-row-drawer-item">
                    <dt>
                      <span>{colSpec?.label ?? humanize(col.name)}</span>
                      <code>{col.name}</code>
                    </dt>
                    <dd>{formatted}</dd>
                  </div>
                )
              })}
            </dl>
            <details className="odd-row-drawer-raw">
              <summary>{t('Raw JSON')}</summary>
              <pre>{JSON.stringify(detailRow, null, 2)}</pre>
            </details>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

/** Rows to look up, not a picture: top-N lists, recent records, breakdowns with many columns. */
function TablePanel(props: TableProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Table" state={state} defaultHeight={360}>
      {(run) => <DataTable run={run} props={props} />}
    </PanelFrame>
  )
}

export const Table = editable('Table', TablePanel)
