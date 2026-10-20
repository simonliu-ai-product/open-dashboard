import type { QueryResult } from '../config.js'

export interface ExpectationResult {
  rule: string
  ok: boolean
  /** Why it failed, with the first offending row or value. */
  message?: string
}

type Op = '>' | '>=' | '=' | '==' | '!=' | '<' | '<='

const OPS: Record<Op, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '=': (a, b) => a === b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
}

const NAME = '([A-Za-z_][A-Za-z0-9_]*|"[^"]+")'
const NUM = '(-?\\d+(?:\\.\\d+)?)'
const ROWS_CMP = new RegExp(`^rows\\s*(>=|<=|==|!=|=|>|<)\\s*${NUM}$`, 'i')
const ROWS_BETWEEN = new RegExp(`^rows\\s+between\\s+${NUM}\\s+and\\s+${NUM}$`, 'i')
const LIST = /^(not_null|unique)\s+(.+)$/i
const COL_BETWEEN = new RegExp(`^${NAME}\\s+between\\s+${NUM}\\s+and\\s+${NUM}$`, 'i')
const COL_CMP = new RegExp(`^${NAME}\\s*(>=|<=|==|!=|=|>|<)\\s*${NUM}$`)

const unquote = (name: string) => name.replace(/^"(.*)"$/, '$1')

export class ExpectationError extends Error {}

/** A rule that cannot be read is the author's mistake, reported as such — never silently passed. */
export function parseExpectation(rule: string): (result: QueryResult) => ExpectationResult {
  const text = rule.trim()
  const fail = (message: string): ExpectationResult => ({ rule: text, ok: false, message })
  const pass: ExpectationResult = { rule: text, ok: true }

  const columnsOf = (result: QueryResult, names: string[]): string | undefined => {
    const have = new Set(result.columns.map((c) => c.name))
    return names.find((n) => !have.has(n))
  }
  const numeric = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : Number.NaN
  }

  let m = ROWS_CMP.exec(text)
  if (m) {
    const op = m[1] as Op
    const n = Number(m[2])
    return (r) =>
      OPS[op](r.rows.length, n) ? pass : fail(`has ${r.rows.length} rows, expected rows ${op} ${n}`)
  }
  m = ROWS_BETWEEN.exec(text)
  if (m) {
    const lo = Number(m[1])
    const hi = Number(m[2])
    return (r) =>
      r.rows.length >= lo && r.rows.length <= hi
        ? pass
        : fail(`has ${r.rows.length} rows, expected between ${lo} and ${hi}`)
  }
  m = LIST.exec(text)
  if (m) {
    const kind = (m[1] ?? '').toLowerCase()
    const names = (m[2] ?? '')
      .split(',')
      .map((n) => unquote(n.trim()))
      .filter(Boolean)
    if (names.length === 0) throw new ExpectationError(`"${text}" names no column`)
    return (r) => {
      const missing = columnsOf(r, names)
      if (missing) return fail(`has no column "${missing}"`)
      if (kind === 'not_null') {
        for (const [i, row] of r.rows.entries()) {
          const empty = names.find((n) => row[n] === null || row[n] === undefined)
          if (empty) return fail(`row ${i + 1} has no "${empty}"`)
        }
        return pass
      }
      const seen = new Map<string, number>()
      for (const [i, row] of r.rows.entries()) {
        const key = JSON.stringify(names.map((n) => row[n] ?? null))
        const first = seen.get(key)
        if (first !== undefined) {
          return fail(`rows ${first + 1} and ${i + 1} share ${names.join(', ')} = ${key}`)
        }
        seen.set(key, i)
      }
      return pass
    }
  }
  m = COL_BETWEEN.exec(text)
  if (m) {
    const column = unquote(m[1] ?? '')
    const lo = Number(m[2])
    const hi = Number(m[3])
    return (r) => {
      if (columnsOf(r, [column])) return fail(`has no column "${column}"`)
      for (const [i, row] of r.rows.entries()) {
        const v = numeric(row[column])
        if (v === undefined) continue
        if (Number.isNaN(v) || v < lo || v > hi) {
          return fail(
            `row ${i + 1}: ${column} = ${String(row[column])}, not between ${lo} and ${hi}`,
          )
        }
      }
      return pass
    }
  }
  m = COL_CMP.exec(text)
  if (m && m[1]?.toLowerCase() !== 'rows') {
    const column = unquote(m[1] ?? '')
    const op = m[2] as Op
    const n = Number(m[3])
    return (r) => {
      if (columnsOf(r, [column])) return fail(`has no column "${column}"`)
      for (const [i, row] of r.rows.entries()) {
        const v = numeric(row[column])
        if (v === undefined) continue
        if (Number.isNaN(v) || !OPS[op](v, n)) {
          return fail(`row ${i + 1}: ${column} = ${String(row[column])}, expected ${op} ${n}`)
        }
      }
      return pass
    }
  }
  throw new ExpectationError(
    `"${text}" is not an expectation — use rows > 0, rows between 1 and 10, not_null a, b, unique a, b, col between 0 and 1, or col >= 0`,
  )
}

export function checkExpectations(rules: string[], result: QueryResult): ExpectationResult[] {
  return rules.map((rule) => {
    try {
      return parseExpectation(rule)(result)
    } catch (error) {
      return { rule, ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })
}
