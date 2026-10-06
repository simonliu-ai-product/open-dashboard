import type { JsonTable, ParamValue, QueryResult, Row, TableInfo } from '../config.js'
import { parseDuration } from '../ops/query-cache.js'
import { sqlWords } from './guard.js'
import { normalizeRows } from './normalize.js'
import { MissingParamError } from './params.js'
import { combineResults } from './scratch.js'
import { type Datasource, DatasourceError, type QueryOptions, type ToolCatalog } from './types.js'

/**
 * The shared half of the HTTP and MCP sources: something that fetches JSON per
 * table, and the SQL that runs over it. A query fetches only the tables it
 * names, loads them into a scratch in-memory SQLite and runs there — so the
 * same SQL, filters, `check` and `-- uses:` work as over a database, and
 * nothing in the SQL can reach the API itself.
 */

/** The array of rows inside a response: at `path`, or the response itself, or its first array. */
export function pickRows(body: unknown, path: string | undefined, where: string): unknown[] {
  let value: unknown = body
  if (path) {
    for (const key of path.split('.').filter(Boolean)) {
      if (value === null || typeof value !== 'object') {
        throw new DatasourceError(`${where}: no "${path}" in the response`)
      }
      value = (value as Record<string, unknown>)[key]
    }
  } else if (!Array.isArray(value) && value && typeof value === 'object') {
    value = Object.values(value).find(Array.isArray) ?? [value]
  }
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return [value]
  throw new DatasourceError(
    `${where}: the rows are not a list — set \`rows\` to the path of the array in the response`,
  )
}

/**
 * Rows as a result: columns in first-seen order across rows, nested values as
 * JSON text. SQLite column names ignore case, so `rtMessage` in one row and
 * `rtmessage` in the next are one column, named as first seen.
 */
export function rowsToResult(items: unknown[], elapsedMs: number): QueryResult {
  const names: string[] = []
  const seen = new Map<string, string>()
  const rows: Row[] = items.map((item) => {
    const source: Record<string, unknown> =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { value: item }
    const row: Row = {}
    for (const [key, value] of Object.entries(source)) {
      let name = seen.get(key.toLowerCase())
      if (name === undefined) {
        name = key
        seen.set(key.toLowerCase(), key)
        names.push(key)
      }
      if (name in row && row[name] !== null && row[name] !== undefined) continue
      row[name] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value
    }
    return row
  })
  for (const row of rows) for (const name of names) if (!(name in row)) row[name] = null
  return { ...normalizeRows(rows, names), truncated: false, elapsedMs }
}

/** `:name` placeholders in a table's URL or arguments, filled from the query's parameters. */
export function bindTableValue(
  value: unknown,
  params: Record<string, ParamValue>,
  encode = (text: string) => text,
): unknown {
  if (typeof value === 'string') {
    const whole = /^:([A-Za-z_][A-Za-z0-9_]*)$/.exec(value)
    if (whole) {
      const name = whole[1] as string
      if (!(name in params)) throw new MissingParamError([name])
      return params[name]
    }
    // A placeholder starts with a letter: `https://` and `host:8443` are left alone.
    return value.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => {
      if (!(name in params)) throw new MissingParamError([name])
      return encode(String(params[name] ?? ''))
    })
  }
  if (Array.isArray(value)) return value.map((item) => bindTableValue(item, params, encode))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, bindTableValue(inner, params, encode)]),
    )
  }
  return value
}

const PLACEHOLDER = /:([A-Za-z_][A-Za-z0-9_]*)/g

/**
 * The parameters the tables a query mentions put in their URL or arguments.
 * They change what is fetched without appearing in the SQL, so the result
 * cache has to key on them too.
 */
export function tableParams(sql: string, tables: Record<string, JsonTable>): string[] {
  const found = new Set<string>()
  const scan = (value: unknown): void => {
    if (typeof value === 'string')
      for (const match of value.matchAll(PLACEHOLDER)) found.add(match[1] as string)
    else if (Array.isArray(value)) value.forEach(scan)
    else if (value && typeof value === 'object') Object.values(value).forEach(scan)
  }
  for (const name of tablesIn(sql, Object.keys(tables))) {
    const spec = tables[name] as JsonTable & { url?: unknown; args?: unknown }
    scan(spec.url)
    scan(spec.args)
  }
  return [...found]
}

/** The configured tables a query mentions — only those are fetched. */
export function tablesIn(sql: string, tables: string[]): string[] {
  const words = new Set(sqlWords(sql))
  return tables.filter(
    (name) =>
      words.has(name.toLowerCase()) || sql.includes(`"${name}"`) || sql.includes(`\`${name}\``),
  )
}

export interface JsonSourceSpec<T extends JsonTable> {
  name: string
  type: 'http' | 'mcp' | 'json' | 'csv'
  tables: Record<string, T>
  /** Fetch one table's response body for these parameters. */
  fetch(table: string, spec: T, params: Record<string, ParamValue>): Promise<unknown>
  /** A key that is the same for two fetches that would return the same thing. */
  key(table: string, spec: T, params: Record<string, ParamValue>): string
  /** Where the rows are in what `fetch` returned. Default: the table's `rows`. */
  rowsPath?(spec: T): string | undefined
  tools?(): Promise<ToolCatalog>
  close?(): Promise<void>
}

export function jsonSource<T extends JsonTable>(source: JsonSourceSpec<T>): Datasource {
  const names = Object.keys(source.tables)
  if (names.length === 0) {
    throw new DatasourceError(
      `datasource "${source.name}": no tables — list them under \`tables\``,
      500,
    )
  }
  // Several panels usually read the same table: one fetch serves them all,
  // including requests that arrive while it is in flight.
  const recent = new Map<string, { at: number; ttl: number; value: Promise<QueryResult> }>()

  const load = (table: string, params: Record<string, ParamValue>): Promise<QueryResult> => {
    const spec = source.tables[table] as T
    const ttl = spec.cache === undefined ? 30_000 : (parseDuration(spec.cache) ?? 30_000)
    const key = `${table}\u0000${source.key(table, spec, params)}`
    const hit = recent.get(key)
    if (hit && Date.now() - hit.at < hit.ttl) return hit.value
    const started = performance.now()
    const where = `datasource "${source.name}" table "${table}"`
    const value = source
      .fetch(table, spec, params)
      .then((body) =>
        rowsToResult(
          pickRows(body, source.rowsPath ? source.rowsPath(spec) : spec.rows, where),
          performance.now() - started,
        ),
      )
    recent.set(key, { at: Date.now(), ttl, value })
    value.catch(() => recent.delete(key))
    return value
  }

  return {
    name: source.name,
    type: source.type,
    async query(sql: string, params: Record<string, ParamValue>, options: QueryOptions) {
      const used = tablesIn(sql, names)
      if (used.length === 0) {
        throw new DatasourceError(
          `datasource "${source.name}": the query names none of its tables (${names.join(', ')})`,
        )
      }
      const results = await Promise.all(used.map((table) => load(table, params)))
      const inputs = new Map(used.map((table, i) => [table, results[i] as QueryResult]))
      return combineResults(sql, inputs, params, options.maxRows, source.type)
    },
    async schema() {
      const tables: TableInfo[] = []
      for (const table of names) {
        try {
          const result = await load(table, {})
          tables.push({
            name: table,
            kind: 'table',
            rowCount: result.rows.length,
            columns: result.columns.map((c) => ({
              name: c.name,
              type: c.type === 'unknown' ? 'TEXT' : c.type.toUpperCase(),
              nullable: true,
              primaryKey: false,
            })),
            foreignKeys: [],
          })
        } catch (error) {
          // A table that needs parameters (`:from`) cannot be fetched blind; list it bare.
          if (!(error instanceof MissingParamError)) throw error
          tables.push({ name: table, kind: 'table', columns: [], foreignKeys: [] })
        }
      }
      return { source: source.name, type: source.type, tables }
    },
    ...(source.tools ? { tools: source.tools } : {}),
    async close() {
      recent.clear()
      await source.close?.()
    },
  }
}
