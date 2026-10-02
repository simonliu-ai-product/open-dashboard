import {
  calendarLayout,
  controlLimits,
  horizonFill,
  humanDuration,
  parseTime,
  timeTickFormat,
  timeTicks,
  waterfallSteps,
} from './timeseries.js'

describe('waterfallSteps', () => {
  it('opens with the first row and appends a closing total', () => {
    const steps = waterfallSteps(
      [
        { label: 'Last month', value: 100 },
        { label: 'Beans', value: 20 },
        { label: 'Grinders', value: -30 },
      ],
      'This month',
    )
    expect(steps).toEqual([
      { label: 'Last month', from: 0, to: 100, kind: 'total' },
      { label: 'Beans', from: 100, to: 120, kind: 'up' },
      { label: 'Grinders', from: 120, to: 90, kind: 'down' },
      { label: 'This month', from: 0, to: 90, kind: 'total' },
    ])
  })

  it('uses explicit totals and adds no closing bar', () => {
    const steps = waterfallSteps([
      { label: 'Q1', value: 50, total: true },
      { label: 'up', value: 10 },
      { label: 'Q2', value: 60, total: true },
      { label: 'down', value: -5 },
    ])
    expect(steps.map((s) => [s.from, s.to, s.kind])).toEqual([
      [0, 50, 'total'],
      [50, 60, 'up'],
      [0, 60, 'total'],
      [60, 55, 'down'],
    ])
  })
})

describe('calendarLayout', () => {
  it('lays days Monday-first in week columns', () => {
    const values = new Map([
      ['2026-09-28', 1],
      ['2026-10-04', 7],
    ])
    const layout = calendarLayout(values)
    expect(layout.weeks).toBe(1)
    expect(layout.cells[0]).toEqual({ date: '2026-09-28', col: 0, row: 0, value: 1 })
    expect(layout.cells.at(-1)).toEqual({ date: '2026-10-04', col: 0, row: 6, value: 7 })
    expect(layout.cells).toHaveLength(7)
  })

  it('reaches back at most the given number of weeks', () => {
    const values = new Map([
      ['2024-01-01', 1],
      ['2026-10-02', 2],
    ])
    expect(calendarLayout(values, 53).weeks).toBe(53)
  })
})

describe('controlLimits', () => {
  it('is the mean ± 3 sample standard deviations', () => {
    const limits = controlLimits([2, 4, 4, 4, 5, 5, 7, 9])
    expect(limits.center).toBe(5)
    expect(limits.upper).toBeCloseTo(5 + 3 * Math.sqrt(32 / 7), 10)
    expect(limits.lower).toBeCloseTo(5 - 3 * Math.sqrt(32 / 7), 10)
  })
})

describe('horizonFill', () => {
  it('folds a value into bands', () => {
    expect(horizonFill(25, 30, 3)).toEqual([1, 1, 0.5])
    expect(horizonFill(-5, 30, 3)).toEqual([0, 0, 0])
    expect(horizonFill(99, 30, 3)).toEqual([1, 1, 1])
  })
})

describe('humanDuration', () => {
  it('picks a readable unit', () => {
    expect(humanDuration(45_000)).toEqual({ n: 45, unit: 'seconds' })
    expect(humanDuration(90 * 60_000)).toEqual({ n: 1.5, unit: 'hours' })
    expect(humanDuration(3 * 86_400_000)).toEqual({ n: 3, unit: 'days' })
  })
})

describe('time parsing and ticks', () => {
  it('reads wall-clock strings as local time', () => {
    expect(parseTime('2026-10-02 09:30:00')).toBe(new Date(2026, 9, 2, 9, 30).getTime())
    expect(parseTime('2026-10-02')).toBe(new Date(2026, 9, 2).getTime())
    expect(parseTime('nope')).toBeUndefined()
  })

  it('places day ticks at midnight across a week', () => {
    const start = new Date(2026, 9, 1, 13).getTime()
    const ticks = timeTicks(start, start + 6 * 86_400_000, 8)
    expect(ticks.every((t) => new Date(t).getHours() === 0)).toBe(true)
    expect(ticks.length).toBeGreaterThan(3)
  })
})

describe('timeTickFormat', () => {
  const at = (d: number, h = 0) => new Date(2026, 8, d, h).getTime()
  it('shows the hour when ticks fall inside days, the date when they cross days', () => {
    expect(timeTickFormat([at(29, 0), at(29, 12), at(30, 0)], 'en-US').format(at(29, 12))).toBe(
      '9/29, 12:00',
    )
    expect(timeTickFormat([at(29, 6), at(29, 12)], 'en-US').format(at(29, 12))).toBe('12:00')
  })
  it('shows only the date when every tick is midnight', () => {
    expect(timeTickFormat([at(28), at(29), at(30)], 'en-US').format(at(29))).toBe('9/29')
  })
})
