import { describe, expect, it } from 'vitest'
import { edgeRoom, textWidth, thinTicks } from './row-chart-kit.js'

describe('thinTicks', () => {
  const label = (v: number) => `US$${v.toLocaleString('en-US')}`
  const ticks = [0, 250, 500, 750, 1000, 1250]
  it('keeps every tick when the labels fit', () => {
    expect(thinTicks(ticks, label, 600)).toEqual(ticks)
  })
  it('drops every other tick, keeping the first, when they would touch', () => {
    expect(thinTicks(ticks, label, 260)).toEqual([0, 500, 1000])
  })
})

describe('textWidth', () => {
  it('counts CJK characters as wide', () => {
    expect(textWidth('US$1.5萬')).toBeGreaterThan(textWidth('US$1.55'))
  })
})

describe('edgeRoom', () => {
  it('leaves half the last label past the plot edge', () => {
    expect(edgeRoom([0, 1250], (v) => `US$${v}`)).toBe(Math.ceil(textWidth('US$1250') / 2))
    expect(edgeRoom([0, 5], String)).toBe(16)
  })
})
