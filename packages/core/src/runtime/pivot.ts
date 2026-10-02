import type { Row } from '../config.js'

export type Aggregate = 'sum' | 'count' | 'avg' | 'min' | 'max'

interface Acc {
  sum: number
  count: number
  min: number
  max: number
}

function add(acc: Acc | undefined, value: unknown, agg: Aggregate): Acc {
  const next = acc ?? { sum: 0, count: 0, min: Infinity, max: -Infinity }
  if (agg === 'count') {
    next.count += 1
    return next
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return next
  next.sum += n
  next.count += 1
  next.min = Math.min(next.min, n)
  next.max = Math.max(next.max, n)
  return next
}

function result(acc: Acc | undefined, agg: Aggregate): number | null {
  if (!acc) return null
  if (agg === 'count') return acc.count
  if (acc.count === 0) return null
  if (agg === 'sum') return acc.sum
  if (agg === 'avg') return acc.sum / acc.count
  return agg === 'min' ? acc.min : acc.max
}

export interface PivotRow {
  /** One value per row field: the group path. */
  keys: string[]
  cells: (number | null)[]
  total: number | null
}

export interface Pivot {
  columns: string[]
  rows: PivotRow[]
  columnTotals: (number | null)[]
  grandTotal: number | null
}

const label = (value: unknown) => (value === null || value === undefined ? '—' : String(value))

/**
 * Long rows → a cross-tab. Totals aggregate the underlying rows again rather
 * than adding cells, so an average total is the average of the rows, not of
 * the averages. Rows and columns keep the order they first appear in.
 */
export function pivot(
  data: Row[],
  rowFields: string[],
  columnField: string,
  valueField: string,
  agg: Aggregate = 'sum',
): Pivot {
  const columns: string[] = []
  const rowKeys: string[][] = []
  const rowIndex = new Map<string, number>()
  const cells = new Map<string, Acc>()
  const rowAcc = new Map<number, Acc>()
  const colAcc = new Map<string, Acc>()
  let grand: Acc | undefined

  for (const row of data) {
    const column = label(row[columnField])
    if (!columns.includes(column)) columns.push(column)
    const keys = rowFields.map((field) => label(row[field]))
    const id = keys.join('\u0000')
    let index = rowIndex.get(id)
    if (index === undefined) {
      index = rowKeys.length
      rowKeys.push(keys)
      rowIndex.set(id, index)
    }
    const value = row[valueField]
    const cellId = `${index}\u0000${column}`
    cells.set(cellId, add(cells.get(cellId), value, agg))
    rowAcc.set(index, add(rowAcc.get(index), value, agg))
    colAcc.set(column, add(colAcc.get(column), value, agg))
    grand = add(grand, value, agg)
  }

  return {
    columns,
    rows: rowKeys.map((keys, index) => ({
      keys,
      cells: columns.map((column) => result(cells.get(`${index}\u0000${column}`), agg)),
      total: result(rowAcc.get(index), agg),
    })),
    columnTotals: columns.map((column) => result(colAcc.get(column), agg)),
    grandTotal: result(grand, agg),
  }
}

/** Rows ordered by one column's cells (or the total, column -1), empty cells last, groups kept together. */
export function sortPivotRows(
  rows: PivotRow[],
  column: number,
  direction: 'asc' | 'desc',
): PivotRow[] {
  const value = (row: PivotRow) => (column === -1 ? row.total : row.cells[column])
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (a.keys.length > 1 && a.keys[0] !== b.keys[0]) return 0
    const x = value(a)
    const y = value(b)
    if (x === y) return 0
    if (x === null || x === undefined) return 1
    if (y === null || y === undefined) return -1
    return (x - y) * sign
  })
}
