import type { ParamValue, QueryResult, Row } from '../config.js'
import { assertReadOnlySql } from './guard.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { DatasourceError } from './types.js'

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * What SQLite can store: booleans as 0/1, anything structured as JSON text.
 * In an `integer` column a number goes in as a bigint, which SQLite keeps as
 * INTEGER; bound as a JS number it is REAL, and `home || ':' || away` reads
 * "2.0:6.0".
 */
function storable(value: unknown, integer: boolean): string | number | bigint | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return integer ? BigInt(value) : value
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'bigint') return value.toString()
  return JSON.stringify(value)
}

/** Columns whose every number is a safe integer — the way a database would have typed them. */
function wholeNumberColumns(columns: string[], rows: Row[]): Set<string> {
  return new Set(
    columns.filter((column) => {
      let numbers = 0
      for (const row of rows) {
        const value = row[column]
        if (value === null || value === undefined) continue
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) return false
        numbers++
      }
      return numbers > 0
    }),
  )
}

/**
 * Runs `sql` in a throwaway in-memory SQLite database holding each input
 * result as a table named after its query. The inputs already ran on their own
 * databases, read-only, so this is how a query joins Postgres to ClickHouse:
 * nothing here can reach a real database, and the scratch copy is gone when
 * the query returns.
 */
export async function combineResults(
  sql: string,
  inputs: Map<string, QueryResult>,
  params: Record<string, ParamValue>,
  maxRows: number,
  engine = 'combined query',
  /**
   * Store whole-number columns as INTEGER. JSON and CSV carry no column types,
   * so this types them the way a database would; `-- uses:` inputs keep REAL,
   * since `amount / target` over them has always divided as decimals.
   */
  wholeNumbers = false,
): Promise<QueryResult> {
  const started = performance.now()
  assertReadOnlySql(sql, engine)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  // An empty JSON file or API response has no columns to name. Its table
  // still exists, so a query over it reads no rows instead of failing.
  const empty: string[] = []
  try {
    for (const [name, result] of inputs) {
      const columns = result.columns.map((c) => c.name)
      if (columns.length === 0) {
        empty.push(name)
        db.exec(`CREATE TABLE ${quoteIdent(name)} ("_empty")`)
        continue
      }
      db.exec(`CREATE TABLE ${quoteIdent(name)} (${columns.map(quoteIdent).join(', ')})`)
      const insert = db.prepare(
        `INSERT INTO ${quoteIdent(name)} VALUES (${columns.map(() => '?').join(', ')})`,
      )
      const whole = wholeNumbers ? wholeNumberColumns(columns, result.rows) : new Set<string>()
      db.exec('BEGIN')
      for (const row of result.rows) {
        insert.run(...columns.map((c) => storable(row[c], whole.has(c))))
      }
      db.exec('COMMIT')
    }
    db.exec('PRAGMA query_only = ON')

    const compiled = compileParams(sql, 'question')
    let statement: ReturnType<typeof db.prepare>
    try {
      statement = db.prepare(compiled.text)
    } catch (error) {
      if (empty.length > 0 && /no such column/i.test((error as Error).message)) {
        return { columns: [], rows: [], truncated: false, elapsedMs: performance.now() - started }
      }
      throw error
    }
    const rows: Row[] = []
    let truncated = false
    for (const row of statement.iterate(...(bindParams(compiled.names, params) as never[]))) {
      if (rows.length >= maxRows) {
        truncated = true
        break
      }
      rows.push(row as Row)
    }
    const names =
      rows.length > 0
        ? Object.keys(rows[0] as Row)
        : ((statement as { columns?: () => { name: string }[] }).columns?.().map((c) => c.name) ??
          [])
    // An input cut short makes every join over it incomplete too.
    const cut = [...inputs.values()].some((r) => r.truncated)
    return {
      ...normalizeRows(rows, names),
      truncated: truncated || cut,
      elapsedMs: performance.now() - started,
    }
  } catch (error) {
    if (error instanceof DatasourceError) throw error
    throw new DatasourceError((error as Error).message)
  } finally {
    db.close()
  }
}
