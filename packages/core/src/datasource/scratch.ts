import type { ParamValue, QueryResult, Row } from '../config.js'
import { assertReadOnlySql } from './guard.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { DatasourceError } from './types.js'

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/** What SQLite can store: booleans as 0/1, anything structured as JSON text. */
function storable(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'bigint') return value.toString()
  return JSON.stringify(value)
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
): Promise<QueryResult> {
  const started = performance.now()
  assertReadOnlySql(sql, engine)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  try {
    for (const [name, result] of inputs) {
      const columns = result.columns.map((c) => c.name)
      if (columns.length === 0) {
        throw new DatasourceError(`"${name}" returned no columns to combine`)
      }
      db.exec(`CREATE TABLE ${quoteIdent(name)} (${columns.map(quoteIdent).join(', ')})`)
      const insert = db.prepare(
        `INSERT INTO ${quoteIdent(name)} VALUES (${columns.map(() => '?').join(', ')})`,
      )
      db.exec('BEGIN')
      for (const row of result.rows) insert.run(...columns.map((c) => storable(row[c])))
      db.exec('COMMIT')
    }
    db.exec('PRAGMA query_only = ON')

    const compiled = compileParams(sql, 'question')
    const statement = db.prepare(compiled.text)
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
