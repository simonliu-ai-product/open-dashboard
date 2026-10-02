import { useMemo, useState } from 'react'
import { sequential } from '../runtime/color.js'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { type Aggregate, pivot, sortPivotRows } from '../runtime/pivot.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext } from './panel.js'

export interface PivotTableProps extends PanelProps {
  query: string
  /** The row field, or two for nested groups: `['region', 'channel']`. */
  rows: string | string[]
  /** The field whose values become columns. */
  columns: string
  value: string
  agg?: Aggregate
  format?: Format
  /** Row, column and grand totals. Default true. */
  totals?: boolean
  /** Shade cells by value. */
  heat?: boolean
}

const AGG_LABELS: Record<Aggregate, string> = {
  sum: 'Sum',
  count: 'Count',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
}

function Cross({ run, props }: { run: QueryRun; props: PivotTableProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [sort, setSort] = useState<{ column: number; dir: 'desc' | 'asc' } | null>(null)
  const rowFields = (Array.isArray(props.rows) ? props.rows : [props.rows]).slice(0, 2)
  const agg = props.agg ?? 'sum'
  const totals = props.totals !== false
  const names = new Set(run.result.columns.map((c) => c.name))
  const missing = [...rowFields, props.columns, props.value].filter((field) => !names.has(field))

  const table = useMemo(() => {
    const fields = (Array.isArray(props.rows) ? props.rows : [props.rows]).slice(0, 2)
    const p = pivot(run.result.rows, fields, props.columns, props.value, agg)
    if (p.columns.every((c) => /^\d/.test(c))) {
      const order = p.columns
        .map((c, i) => [c, i] as const)
        .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
      return {
        ...p,
        columns: order.map(([c]) => c),
        rows: p.rows.map((r) => ({ ...r, cells: order.map(([, i]) => r.cells[i] ?? null) })),
        columnTotals: order.map(([, i]) => p.columnTotals[i] ?? null),
      }
    }
    return p
  }, [run, props.rows, props.columns, props.value, agg])

  if (missing.length) {
    return (
      <div className="odd-panel-message">
        {t('The pivot needs columns that are not in the result: {names}', {
          names: missing.join(', '),
        })}
      </div>
    )
  }

  const rows = sort ? sortPivotRows(table.rows, sort.column, sort.dir) : table.rows
  const cellValues = table.rows.flatMap((r) => r.cells).filter((v): v is number => v !== null)
  const min = Math.min(...cellValues)
  const max = Math.max(...cellValues)
  const cycle = (column: number) =>
    setSort((s) =>
      s?.column !== column
        ? { column, dir: 'desc' }
        : s.dir === 'desc'
          ? { column, dir: 'asc' }
          : null,
    )
  const arrow = (column: number) =>
    sort?.column === column ? (sort.dir === 'desc' ? '↓' : '↑') : ''
  const cell = (value: number | null, heat: boolean) => {
    if (value === null) return { text: '—', style: undefined }
    if (!heat || max === min)
      return { text: formatValue(value, props.format, ctx), style: undefined }
    const share = (value - min) / (max - min)
    return {
      text: formatValue(value, props.format, ctx),
      style: {
        background: sequential(share),
        color: share >= 0.6 ? 'var(--odd-series-1-ink)' : 'var(--odd-ink)',
      },
    }
  }

  return (
    <div className="odd-table-wrap">
      <table className="odd-table odd-pivot">
        <caption className="odd-sr-only">
          {t('{agg} of {value} by {rows} and {columns}', {
            agg: t(AGG_LABELS[agg]),
            value: humanize(props.value),
            rows: rowFields.map(humanize).join(', '),
            columns: humanize(props.columns),
          })}
        </caption>
        <thead>
          <tr>
            {rowFields.map((field, i) => (
              <th key={field} className="odd-pivot-key" data-level={i} scope="col">
                <span>{humanize(field)}</span>
              </th>
            ))}
            {table.columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                aria-sort={
                  sort?.column === i ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'
                }
              >
                <button type="button" onClick={() => cycle(i)}>
                  {column}
                  <span className="odd-sort" aria-hidden="true">
                    {arrow(i)}
                  </span>
                </button>
              </th>
            ))}
            {totals ? (
              <th
                scope="col"
                className="odd-pivot-total"
                aria-sort={
                  sort?.column === -1 ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'
                }
              >
                <button type="button" onClick={() => cycle(-1)}>
                  {t('Total')}
                  <span className="odd-sort" aria-hidden="true">
                    {arrow(-1)}
                  </span>
                </button>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const previous = rows[r - 1]
            return (
              <tr key={row.keys.join('\u0000')}>
                {row.keys.map((key, level) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: a row's keys are positional — level 0 is the outer group
                    key={`${level}-${key}`}
                    scope="row"
                    className="odd-pivot-key"
                    data-level={level}
                    data-repeat={
                      level === 0 && row.keys.length > 1 && previous?.keys[0] === key
                        ? ''
                        : undefined
                    }
                  >
                    {key}
                  </th>
                ))}
                {row.cells.map((value, i) => {
                  const c = cell(value, Boolean(props.heat))
                  return (
                    <td key={table.columns[i]} data-numeric style={c.style}>
                      {c.text}
                    </td>
                  )
                })}
                {totals ? (
                  <td data-numeric className="odd-pivot-total">
                    {row.total === null ? '—' : formatValue(row.total, props.format, ctx)}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
        {totals ? (
          <tfoot>
            <tr>
              <th scope="row" colSpan={rowFields.length} className="odd-pivot-key">
                {t('Total')}
              </th>
              {table.columnTotals.map((value, i) => (
                <td key={table.columns[i]} data-numeric>
                  {value === null ? '—' : formatValue(value, props.format, ctx)}
                </td>
              ))}
              <td data-numeric className="odd-pivot-total">
                {table.grandTotal === null ? '—' : formatValue(table.grandTotal, props.format, ctx)}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  )
}

/** A cross-tab from long rows: a field down, a field across, totals both ways. */
function PivotTablePanel(props: PivotTableProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="PivotTable" state={state} defaultHeight={380}>
      {(run) => <Cross run={run} props={props} />}
    </PanelFrame>
  )
}

export const PivotTable = editable('PivotTable', PivotTablePanel)
