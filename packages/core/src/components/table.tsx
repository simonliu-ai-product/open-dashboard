import { useMemo, useState } from 'react'
import type { ColumnInfo } from '../config.js'
import { formatValue } from '../runtime/format.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { PanelFrame, type PanelProps, useFormatContext } from './panel.js'

export interface TableColumn {
  key: string
  label?: string
  format?: Format
  align?: 'left' | 'right' | 'center'
  /** Draw an inline bar proportional to the column's largest value. */
  bar?: boolean
}

export interface TableProps extends PanelProps {
  query: string
  /** Which columns, in which order. Default: all of them. */
  columns?: (string | TableColumn)[]
  /** Formats by column name, for when `columns` is not given. */
  format?: Record<string, Format>
  /** Initial sort: a column name, prefix "-" for descending. Default: the query's order. */
  sort?: string
}

const IDENTIFIER = /(^id$|_id$|^id_)/i
const ID_FORMAT = { useGrouping: false, maximumFractionDigits: 0 } as const

function DataTable({ run, props }: { run: QueryRun; props: TableProps }) {
  const ctx = useFormatContext()
  const [sort, setSort] = useState<string | undefined>(props.sort)
  const types = new Map<string, ColumnInfo['type']>(run.result.columns.map((c) => [c.name, c.type]))
  const columns: TableColumn[] = (props.columns ?? run.result.columns.map((c) => c.name)).map(
    (column) => (typeof column === 'string' ? { key: column } : column),
  )

  const rows = useMemo(() => {
    if (!sort) return run.result.rows
    const desc = sort.startsWith('-')
    const key = desc ? sort.slice(1) : sort
    return [...run.result.rows].sort((a, b) => {
      const x = a[key]
      const y = b[key]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      const order =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return desc ? -order : order
    })
  }, [run, sort])

  const maxima = new Map<string, number>()
  for (const column of columns) {
    if (!column.bar) continue
    maxima.set(
      column.key,
      Math.max(0, ...run.result.rows.map((r) => Number(r[column.key])).filter(Number.isFinite)),
    )
  }

  return (
    <div className="odd-table-wrap">
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
          {rows.slice(0, 1000).map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
            <tr key={i}>
              {columns.map((column) => {
                const numeric = types.get(column.key) === 'number'
                const value = row[column.key]
                const max = maxima.get(column.key)
                return (
                  <td
                    key={column.key}
                    style={{ textAlign: column.align ?? (numeric ? 'right' : 'left') }}
                    data-numeric={numeric || undefined}
                  >
                    {max ? (
                      <span className="odd-cell-bar">
                        <span style={{ width: `${Math.max(0, (Number(value) / max) * 100)}%` }} />
                      </span>
                    ) : null}
                    {formatValue(
                      value,
                      column.format ??
                        props.format?.[column.key] ??
                        (IDENTIFIER.test(column.key) ? ID_FORMAT : undefined),
                      ctx,
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 1000 || run.result.truncated ? (
        <p className="odd-table-note">
          Showing the first {Math.min(rows.length, 1000).toLocaleString()} rows — aggregate in SQL
          for the rest.
        </p>
      ) : null}
    </div>
  )
}

/** Rows to look up, not a picture: top-N lists, recent records, breakdowns with many columns. */
export function Table(props: TableProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Table" state={state} defaultHeight={360}>
      {(run) => <DataTable run={run} props={props} />}
    </PanelFrame>
  )
}
