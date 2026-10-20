import { describe, expect, it } from 'vitest'
import type { QueryResult } from '../config.js'
import { checkExpectations, ExpectationError, parseExpectation } from './expect.js'

const result = (rows: Record<string, unknown>[]): QueryResult => ({
  columns: Object.keys(rows[0] ?? { game: 0, wp: 0 }).map((name) => ({ name, type: 'number' })),
  rows,
  truncated: false,
  elapsedMs: 1,
})

const ok = (rule: string, rows: Record<string, unknown>[]) =>
  parseExpectation(rule)(result(rows)).ok

describe('expectations', () => {
  it('counts rows', () => {
    expect(ok('rows > 0', [{ game: 1 }])).toBe(true)
    expect(ok('rows > 0', [])).toBe(false)
    expect(ok('rows between 1 and 2', [{ game: 1 }, { game: 2 }, { game: 3 }])).toBe(false)
    expect(ok('ROWS = 1', [{ game: 1 }])).toBe(true)
  })

  it('finds the first empty value', () => {
    const r = parseExpectation('not_null game, wp')(
      result([
        { game: 1, wp: 0.5 },
        { game: 2, wp: null },
      ]),
    )
    expect(r.ok).toBe(false)
    expect(r.message).toBe('row 2 has no "wp"')
  })

  it('finds a repeated key across columns', () => {
    const r = parseExpectation('unique game, seq')(
      result([
        { game: 1, seq: 1 },
        { game: 1, seq: 2 },
        { game: 1, seq: 1 },
      ]),
    )
    expect(r.message).toBe('rows 1 and 3 share game, seq = [1,1]')
  })

  it('bounds every value, skipping empty ones', () => {
    expect(ok('wp between 0 and 1', [{ wp: 0 }, { wp: null }, { wp: 1 }])).toBe(true)
    expect(ok('wp between 0 and 1', [{ wp: 1.2 }])).toBe(false)
    expect(ok('wp >= 0', [{ wp: '0.3' }])).toBe(true)
    expect(ok('wp >= 0', [{ wp: 'n/a' }])).toBe(false)
  })

  it('reports a column the result does not have', () => {
    expect(parseExpectation('not_null missing')(result([{ game: 1 }])).message).toBe(
      'has no column "missing"',
    )
  })

  it('refuses a rule it cannot read instead of passing it', () => {
    expect(() => parseExpectation('looks fine to me')).toThrow(ExpectationError)
    const [r] = checkExpectations(['looks fine to me'], result([]))
    expect(r?.ok).toBe(false)
  })
})
