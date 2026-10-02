import { bumpRanks, declutter, marimekko, readRef } from './comparison.js'

describe('readRef', () => {
  it('reads a literal or a column', () => {
    expect(readRef({ t: '12' }, 'nope')).toBeUndefined()
    expect(readRef({ t: '12' }, 't')).toBe(12)
    expect(readRef({}, 5)).toBe(5)
    expect(readRef({ t: null }, 't')).toBeUndefined()
  })
})

describe('declutter', () => {
  it('keeps order, enforces the gap and the bounds', () => {
    const out = declutter([10, 11, 12, 100], 10, 0, 100)
    expect(out).toEqual([10, 20, 30, 100])
    const crowded = declutter([95, 96, 97], 10, 0, 100)
    expect(crowded).toEqual([80, 90, 100])
  })

  it('maps back to the input order', () => {
    expect(declutter([50, 10], 10, 0, 100)).toEqual([50, 10])
  })
})

describe('bumpRanks', () => {
  const rows = [
    { m: 'Jan', p: 'A', v: 10 },
    { m: 'Jan', p: 'B', v: 20 },
    { m: 'Jan', p: 'C', v: 5 },
    { m: 'Feb', p: 'A', v: 30 },
    { m: 'Feb', p: 'B', v: 20 },
    { m: 'Feb', p: 'C', v: 20 },
  ]

  it('ranks highest first with shared ranks for ties', () => {
    const data = bumpRanks(rows, 'm', 'p', 'v')
    expect(data.categories).toEqual(['Jan', 'Feb'])
    const byName = Object.fromEntries(data.entities.map((e) => [e.name, e.ranks]))
    expect(byName).toEqual({ A: [2, 1], B: [1, 2], C: [3, 2] })
    expect(data.entities.map((e) => e.name)).toEqual(['A', 'B', 'C'])
  })

  it('keeps only entities that reach the top N, and can rank ascending', () => {
    expect(bumpRanks(rows, 'm', 'p', 'v', { top: 1 }).entities.map((e) => e.name)).toEqual([
      'A',
      'B',
    ])
    const asc = bumpRanks(rows, 'm', 'p', 'v', { ascending: true })
    expect(asc.entities.find((e) => e.name === 'C')?.ranks).toEqual([1, 1])
  })
})

describe('marimekko', () => {
  it('sizes columns by total and segments by share', () => {
    const data = marimekko(
      [
        { r: 'N', c: 'web', v: 30 },
        { r: 'N', c: 'app', v: 10 },
        { r: 'S', c: 'web', v: 60 },
      ],
      'r',
      'c',
      'v',
    )
    expect(data.total).toBe(100)
    expect(data.series).toEqual(['web', 'app'])
    expect(data.columns.map((c) => [c.x0, c.x1])).toEqual([
      [0, 0.4],
      [0.4, 1],
    ])
    expect(data.columns[0]?.segments.map((s) => [s.series, s.y0, s.y1])).toEqual([
      ['web', 0, 0.75],
      ['app', 0.75, 1],
    ])
  })
})
