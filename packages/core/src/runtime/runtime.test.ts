import { formatValue, tickFormatter } from './format.js'
import { niceDomain, thinIndices } from './scale.js'
import { humanize, MAX_SERIES, shapeSeries } from './shape.js'
import { resolveTimeRange, timeRangeParams } from './time-range.js'

const ctx = { locale: 'en-US', currency: 'USD' }

describe('time ranges', () => {
  const now = new Date(2026, 9, 2, 15, 30)

  it('ends tomorrow, exclusive, so today is included', () => {
    expect(resolveTimeRange('today', now)).toEqual({ from: '2026-10-02', to: '2026-10-03' })
    expect(resolveTimeRange('7d', now)).toEqual({ from: '2026-09-26', to: '2026-10-03' })
  })

  it('anchors calendar presets on the calendar', () => {
    expect(resolveTimeRange('mtd', now).from).toBe('2026-10-01')
    expect(resolveTimeRange('ytd', now).from).toBe('2026-01-01')
    expect(resolveTimeRange('all', now)).toEqual({ from: '0001-01-01', to: '9999-12-31' })
  })

  it('prefixes params with the filter name', () => {
    expect(Object.keys(timeRangeParams(undefined, '30d', now))).toEqual(['from', 'to'])
    expect(Object.keys(timeRangeParams('signup', '30d', now))).toEqual(['signup_from', 'signup_to'])
  })
})

describe('niceDomain', () => {
  it('includes zero and rounds outward', () => {
    expect(niceDomain([120, 870])).toEqual({
      min: 0,
      max: 1000,
      ticks: [0, 200, 400, 600, 800, 1000],
    })
  })

  it('spans negatives', () => {
    const domain = niceDomain([-30, 45])
    expect(domain.min).toBeLessThanOrEqual(-30)
    expect(domain.ticks).toContain(0)
  })

  it('survives a flat or empty series', () => {
    expect(niceDomain([]).ticks.length).toBeGreaterThan(1)
    expect(niceDomain([5, 5]).max).toBeGreaterThanOrEqual(5)
  })
})

describe('thinIndices', () => {
  it('keeps first and last without crowding the end', () => {
    const kept = thinIndices(14, 6)
    expect(kept[0]).toBe(0)
    expect(kept.at(-1)).toBe(13)
    for (let i = 1; i < kept.length; i += 1)
      expect((kept[i] as number) - (kept[i - 1] as number)).toBeGreaterThanOrEqual(3)
  })
})

describe('shapeSeries', () => {
  const rows = [
    { month: '2026-01', channel: 'web', revenue: 10 },
    { month: '2026-01', channel: 'mobile', revenue: 5 },
    { month: '2026-02', channel: 'web', revenue: 12 },
  ]

  it('pivots long rows on the series column, leaving gaps as null', () => {
    const shaped = shapeSeries(rows, 'month', ['revenue'], 'channel')
    expect(shaped.categories).toEqual(['2026-01', '2026-02'])
    expect(shaped.series.map((s) => [s.key, s.values])).toEqual([
      ['web', [10, 12]],
      ['mobile', [5, null]],
    ])
  })

  it('folds the tail past eight series into Other', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ x: 'a', s: `s${i}`, v: i + 1 }))
    const shaped = shapeSeries(many, 'x', ['v'], 's')
    expect(shaped.series).toHaveLength(MAX_SERIES)
    expect(shaped.series.at(-1)?.label).toBe('Other')
    expect(shaped.series.reduce((sum, s) => sum + (s.values[0] ?? 0), 0)).toBe(78)
  })

  it('humanizes column names', () => {
    expect(humanize('new_customers')).toBe('New customers')
    expect(humanize('revenuePerUser')).toBe('Revenue Per User')
  })
})

describe('formats', () => {
  it('formats named formats', () => {
    expect(formatValue(1234.5, 'currency', ctx)).toBe('$1,235')
    expect(formatValue(12.5, 'currency', ctx)).toBe('$12.50')
    expect(formatValue(0.123, 'percent', ctx)).toBe('12%')
    expect(formatValue(0.042, 'percent', ctx)).toBe('4.2%')
    expect(formatValue(1_250_000, 'compact', ctx)).toBe('1.3M')
    expect(formatValue(null, 'currency', ctx)).toBe('—')
    expect(formatValue('2026-03', 'month', ctx)).toBe('Mar 2026')
  })

  it('formats every tick on an axis the same way', () => {
    const ticks = [0, 2000, 4000, 6000, 8000, 10000]
    const format = tickFormatter(ticks, 'currency', ctx)
    expect(ticks.map(format)).toEqual(['$0', '$2K', '$4K', '$6K', '$8K', '$10K'])
    expect([0, 0.5, 1].map(tickFormatter([0, 0.5, 1], undefined, ctx))).toEqual(['0', '0.5', '1'])
  })

  it('keeps a 萬 axis consistent: compact only when every tick reaches 10,000', () => {
    const zh = { locale: 'zh-TW', currency: 'USD' }
    const low = [0, 2000, 4000, 6000, 8000, 10000]
    expect(low.map(tickFormatter(low, 'integer', zh))).toEqual([
      '0',
      '2,000',
      '4,000',
      '6,000',
      '8,000',
      '10,000',
    ])
    const high = [0, 50000, 100000]
    expect(high.map(tickFormatter(high, 'integer', zh))).toEqual(['0', '5萬', '10萬'])
  })
})
