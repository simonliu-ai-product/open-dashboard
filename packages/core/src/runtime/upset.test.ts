import { upsetData } from './upset.js'

describe('upsetData', () => {
  it('merges combinations regardless of order and totals each set', () => {
    const out = upsetData(
      [
        { s: 'Beans', n: 50 },
        { s: 'Grinders, Beans', n: 20 },
        { s: 'Beans,Grinders', n: 5 },
        { s: 'Brewing', n: 10 },
        { s: '', n: 3 },
        { s: 'Beans', n: 0 },
      ],
      { sets: 's', value: 'n' },
    )
    expect(out.intersections).toEqual([
      { sets: ['Beans'], value: 50 },
      { sets: ['Beans', 'Grinders'], value: 25 },
      { sets: ['Brewing'], value: 10 },
    ])
    expect(out.sets).toEqual([
      { name: 'Beans', total: 75 },
      { name: 'Grinders', total: 25 },
      { name: 'Brewing', total: 10 },
    ])
    expect(out.hidden).toBe(0)
  })

  it('keeps the top intersections and counts the rest', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ s: `S${i}`, n: 20 - i }))
    const out = upsetData(rows, { sets: 's', value: 'n' }, 15)
    expect(out.intersections).toHaveLength(15)
    expect(out.hidden).toBe(5)
  })
})
