import { humanDuration, stateSegments, stateTotals } from './state-segments.js'

describe('stateSegments', () => {
  const rows = [
    { lane: 'api', at: 0, state: 'up' },
    { lane: 'api', at: 10, state: 'up' },
    { lane: 'api', at: 20, state: 'down' },
    { lane: 'api', at: 25, state: 'up' },
    { lane: 'db', at: 5, state: 'degraded' },
    { lane: 'db', at: 30, state: 'up' },
  ]

  it('runs each state until the lane’s next row, merging repeats', () => {
    const { lanes, segments, start, end } = stateSegments(rows)
    expect(lanes).toEqual(['api', 'db'])
    expect(segments.filter((s) => s.lane === 'api')).toEqual([
      { lane: 'api', state: 'up', start: 0, end: 20 },
      { lane: 'api', state: 'down', start: 20, end: 25 },
      { lane: 'api', state: 'up', start: 25, end: 30 },
    ])
    expect(start).toBe(0)
    expect(end).toBe(30)
  })

  it('honours explicit ends and an explicit horizon', () => {
    const { segments } = stateSegments(
      [
        { lane: 'x', at: 0, end: 5, state: 'down' },
        { lane: 'x', at: 8, state: 'up' },
      ],
      12,
    )
    expect(segments).toEqual([
      { lane: 'x', state: 'down', start: 0, end: 5 },
      { lane: 'x', state: 'up', start: 8, end: 12 },
    ])
  })

  it('totals time per state', () => {
    expect(stateTotals(stateSegments(rows).segments).get('up')).toBe(25)
  })

  it('reads durations', () => {
    expect(humanDuration(45_000)).toBe('45 s')
    expect(humanDuration(3 * 60_000 + 5_000)).toBe('3 min 5 s')
    expect(humanDuration(2 * 3_600_000 + 20 * 60_000)).toBe('2 h 20 min')
    expect(humanDuration(26 * 3_600_000)).toBe('1 d 2 h')
  })
})
