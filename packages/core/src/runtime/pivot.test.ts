import { pivot, sortPivotRows } from './pivot.js'

const data = [
  { region: 'North', channel: 'web', month: '2026-01', revenue: 10 },
  { region: 'North', channel: 'mobile', month: '2026-01', revenue: 5 },
  { region: 'North', channel: 'web', month: '2026-02', revenue: 20 },
  { region: 'South', channel: 'web', month: '2026-01', revenue: 7 },
  { region: 'South', channel: 'web', month: '2026-01', revenue: null },
]

describe('pivot', () => {
  it('sums into a cross-tab with row, column and grand totals', () => {
    const p = pivot(data, ['region'], 'month', 'revenue')
    expect(p.columns).toEqual(['2026-01', '2026-02'])
    expect(p.rows).toEqual([
      { keys: ['North'], cells: [15, 20], total: 35 },
      { keys: ['South'], cells: [7, null], total: 7 },
    ])
    expect(p.columnTotals).toEqual([22, 20])
    expect(p.grandTotal).toBe(42)
  })

  it('averages totals over the underlying rows, not over the cells', () => {
    const p = pivot(data, ['region'], 'month', 'revenue', 'avg')
    expect(p.rows[0]?.cells).toEqual([7.5, 20])
    expect(p.rows[0]?.total).toBeCloseTo(35 / 3)
  })

  it('counts every row, nulls included, and nests two row fields', () => {
    const p = pivot(data, ['region', 'channel'], 'month', 'revenue', 'count')
    expect(p.rows.map((r) => r.keys)).toEqual([
      ['North', 'web'],
      ['North', 'mobile'],
      ['South', 'web'],
    ])
    expect(p.rows[2]?.cells).toEqual([2, null])
  })

  it('takes min and max, ignoring empty values', () => {
    expect(pivot(data, ['region'], 'month', 'revenue', 'min').rows[1]?.cells[0]).toBe(7)
    expect(pivot(data, ['region'], 'month', 'revenue', 'max').grandTotal).toBe(20)
  })

  it('sorts rows by a column or the total, empty cells last', () => {
    const p = pivot(data, ['region'], 'month', 'revenue')
    expect(sortPivotRows(p.rows, 1, 'asc').map((r) => r.keys[0])).toEqual(['North', 'South'])
    expect(sortPivotRows(p.rows, -1, 'asc').map((r) => r.keys[0])).toEqual(['South', 'North'])
  })
})
