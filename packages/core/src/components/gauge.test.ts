import { describe, expect, it } from 'vitest'
import { arc } from './gauge.js'

describe('gauge arc', () => {
  it('draws the short way round for any share of the half circle', () => {
    for (const to of [0.1, 0.5, 0.51, 0.88, 1]) {
      const flags = arc(100, 100, 50, 0, to).match(/A50,50 0 (\d) 1/)
      expect(flags?.[1], `value ${to}`).toBe('0')
    }
  })

  it('starts on the left and ends on the arc at the value', () => {
    const [, x0, y0, x1, y1] = arc(100, 100, 50, 0, 0.5).match(
      /M([\d.]+),([\d.]+)A.* ([\d.-]+),([\d.-]+)$/,
    ) as RegExpMatchArray
    expect([Number(x0), Number(y0)]).toEqual([50, 100])
    expect(Number(x1)).toBeCloseTo(100)
    expect(Number(y1)).toBeCloseTo(50)
  })
})
