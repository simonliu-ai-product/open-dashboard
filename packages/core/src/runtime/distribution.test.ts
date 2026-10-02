import {
  boxStats,
  concentration,
  ecdf,
  histogram,
  jitter,
  numbers,
  quantile,
  shareAt,
} from './distribution.js'

describe('distribution helpers', () => {
  it('reads numbers, dropping blanks and text', () => {
    expect(numbers([3, '1', null, '', 'x', 2])).toEqual([1, 2, 3])
  })

  it('interpolates quantiles like R type 7', () => {
    const s = [1, 2, 3, 4]
    expect(quantile(s, 0.5)).toBe(2.5)
    expect(quantile(s, 0.25)).toBe(1.75)
    expect(quantile([7], 0.9)).toBe(7)
  })

  it('computes a box with whiskers at 1.5 IQR and outliers beyond', () => {
    const b = boxStats([1, 2, 3, 4, 5, 6, 7, 8, 100])
    expect(b?.median).toBe(5)
    expect(b?.q1).toBe(3)
    expect(b?.q3).toBe(7)
    expect(b?.high).toBe(8)
    expect(b?.outliers).toEqual([100])
    expect(boxStats([])).toBeUndefined()
  })

  it('bins on round edges and counts every value once', () => {
    const values = numbers(Array.from({ length: 200 }, (_, i) => (i * 37) % 101))
    const bins = histogram(values)
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(200)
    expect(bins.length).toBeGreaterThanOrEqual(5)
    expect(bins.length).toBeLessThanOrEqual(61)
    for (const b of bins)
      expect(Number.isInteger(b.from) || b.from.toString().length < 8).toBe(true)
    expect(histogram([4, 4, 4])).toEqual([{ from: 4, to: 4, count: 3 }])
    expect(histogram(numbers([0, 10]), 5).map((b) => b.from)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it('steps the ECDF once per distinct value', () => {
    expect(ecdf([1, 1, 2, 4])).toEqual([
      { value: 1, share: 0.5 },
      { value: 2, share: 0.75 },
      { value: 4, share: 1 },
    ])
  })

  it('measures concentration largest first', () => {
    const steps = concentration([
      { label: 'a', value: 10 },
      { label: 'b', value: 60 },
      { label: 'c', value: 30 },
      { label: 'd', value: 0 },
    ])
    expect(steps.map((s) => s.label)).toEqual(['b', 'c', 'a'])
    expect(steps[0]?.share).toBeCloseTo(0.6)
    expect(shareAt(steps, 1 / 3)).toBeCloseTo(0.6)
    expect(shareAt(steps, 0.5)).toBeCloseTo(0.75)
    expect(shareAt(steps, 1)).toBe(1)
  })

  it('jitters deterministically within half a unit', () => {
    expect(jitter(5)).toBe(jitter(5))
    for (let i = 0; i < 100; i += 1) expect(Math.abs(jitter(i))).toBeLessThanOrEqual(0.5)
  })
})
