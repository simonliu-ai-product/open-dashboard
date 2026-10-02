import { cohortMatrix } from './cohort.js'

describe('cohortMatrix', () => {
  const rows = [
    { m: '2026-01', p: 0, n: 100 },
    { m: '2026-01', p: 1, n: 40 },
    { m: '2026-01', p: 2, n: 30 },
    { m: '2026-02', p: 0, n: 80 },
    { m: '2026-02', p: 1, n: 36 },
    { m: '2026-03', p: 0, n: 50 },
    { m: '2026-03', p: 'x', n: 5 },
  ]

  it('builds a triangle in first-seen order with period 0 as size', () => {
    const out = cohortMatrix(rows, { cohort: 'm', period: 'p', value: 'n' })
    expect(out.periods).toBe(3)
    expect(out.rows.map((r) => [r.cohort, r.size, r.values])).toEqual([
      ['2026-01', 100, [100, 40, 30]],
      ['2026-02', 80, [80, 36, undefined]],
      ['2026-03', 50, [50, undefined, undefined]],
    ])
  })

  it('uses a size column when given', () => {
    const out = cohortMatrix(
      [
        { m: 'a', p: 1, n: 10, s: 40 },
        { m: 'a', p: 0, n: 30, s: 40 },
      ],
      { cohort: 'm', period: 'p', value: 'n', size: 's' },
    )
    expect(out.rows[0]).toEqual({ cohort: 'a', size: 40, values: [30, 10] })
  })
})
