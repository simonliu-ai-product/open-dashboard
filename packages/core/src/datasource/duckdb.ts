import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DuckdbSource, Row, TableInfo } from '../config.js'
import { assertReadOnlySql } from './guard.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { importPeer } from './peer.js'
import { type Datasource, DatasourceError } from './types.js'

interface DuckReader {
  columnNames(): string[]
  getRowObjectsJS(): Row[]
  getRowObjectsJson(): Row[]
  currentRowCount: number
}
interface DuckConnection {
  runAndReadUntil(sql: string, rows: number, values?: unknown[]): Promise<DuckReader>
  runAndReadAll(sql: string, values?: unknown[]): Promise<DuckReader>
  closeSync(): void
}
interface DuckInstance {
  connect(): Promise<DuckConnection>
  closeSync(): void
}
interface DuckModule {
  DuckDBInstance: { create(path?: string, options?: Record<string, string>): Promise<DuckInstance> }
}

function quote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`
}

/**
 * A database file opens READ_ONLY. `:memory:` (for querying Parquet / CSV in
 * place) cannot, so every query also passes the lexical check, which refuses
 * COPY, ATTACH, INSTALL and friends. Relative file paths in SQL resolve
 * against the workspace, not wherever the server happened to start.
 */
export async function openDuckdb(
  name: string,
  config: DuckdbSource,
  root: string,
): Promise<Datasource> {
  const memory = !config.file || config.file === ':memory:'
  const file = memory ? ':memory:' : resolve(root, config.file as string)
  if (!memory && !existsSync(file)) {
    throw new DatasourceError(`datasource "${name}": no DuckDB file at ${file}`, 500)
  }
  const { DuckDBInstance } = await importPeer<DuckModule>(
    '@duckdb/node-api',
    root,
    '@duckdb/node-api',
  )
  const instance = await DuckDBInstance.create(file, memory ? {} : { access_mode: 'READ_ONLY' })
  const connection = await instance.connect()
  await connection.runAndReadAll(`SET file_search_path = ${quote(root)}`)
  for (const statement of config.init ?? []) await connection.runAndReadAll(statement)

  const read = (reader: DuckReader, limit: number): Row[] => {
    const js = reader.getRowObjectsJS().slice(0, limit)
    const json = reader.getRowObjectsJson()
    return js.map((row, i) => {
      const out: Row = {}
      for (const [key, value] of Object.entries(row))
        out[key] = value instanceof Date ? json[i]?.[key] : value
      return out
    })
  }

  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.catch(() => {})
    return next
  }

  return {
    name,
    type: 'duckdb',
    query(text, params, options) {
      return serial(async () => {
        const started = performance.now()
        assertReadOnlySql(text, 'DuckDB')
        const compiled = compileParams(text, 'dollar')
        const values = bindParams(compiled.names, params)
        const reader = await connection.runAndReadUntil(compiled.text, options.maxRows + 1, values)
        const rows = read(reader, options.maxRows)
        return {
          ...normalizeRows(rows, reader.columnNames()),
          truncated: reader.currentRowCount > options.maxRows,
          elapsedMs: performance.now() - started,
        }
      })
    },
    schema() {
      return serial(async () => {
        const columns = read(
          await connection.runAndReadAll(`
            SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable, t.table_type
            FROM information_schema.columns c
            JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema NOT IN ('information_schema', 'pg_catalog')
            ORDER BY c.table_schema, c.table_name, c.ordinal_position`),
          Number.MAX_SAFE_INTEGER,
        )
        const constraints = read(
          await connection.runAndReadAll(`
            SELECT schema_name, table_name, constraint_type, constraint_column_names,
                   referenced_table, referenced_column_names
            FROM duckdb_constraints() WHERE constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`),
          Number.MAX_SAFE_INTEGER,
        )
        const sizes = read(
          await connection.runAndReadAll(
            'SELECT schema_name, table_name, estimated_size FROM duckdb_tables()',
          ),
          Number.MAX_SAFE_INTEGER,
        )
        const key = (schema: unknown, table: unknown) => `${schema}.${table}`
        const tables = new Map<string, TableInfo>()
        const primary = new Set<string>()
        for (const c of constraints) {
          if (c.constraint_type !== 'PRIMARY KEY') continue
          for (const column of (c.constraint_column_names as string[]) ?? []) {
            primary.add(`${key(c.schema_name, c.table_name)}.${column}`)
          }
        }
        for (const row of columns) {
          const id = key(row.table_schema, row.table_name)
          let table = tables.get(id)
          if (!table) {
            table = {
              name: String(row.table_name),
              kind: String(row.table_type).includes('VIEW') ? 'view' : 'table',
              columns: [],
              foreignKeys: [],
            }
            if (row.table_schema !== 'main') table.schema = String(row.table_schema)
            tables.set(id, table)
          }
          table.columns.push({
            name: String(row.column_name),
            type: String(row.data_type),
            nullable: row.is_nullable === 'YES',
            primaryKey: primary.has(`${id}.${row.column_name}`),
          })
        }
        for (const c of constraints) {
          if (c.constraint_type !== 'FOREIGN KEY') continue
          const from = (c.constraint_column_names as string[]) ?? []
          const to = (c.referenced_column_names as string[]) ?? []
          from.forEach((column, i) => {
            tables.get(key(c.schema_name, c.table_name))?.foreignKeys.push({
              column,
              table: String(c.referenced_table),
              references: String(to[i] ?? ''),
            })
          })
        }
        for (const size of sizes) {
          const table = tables.get(key(size.schema_name, size.table_name))
          if (table && size.estimated_size !== null) table.rowCount = Number(size.estimated_size)
        }
        return { source: name, type: 'duckdb' as const, tables: [...tables.values()] }
      })
    },
    async close() {
      connection.closeSync()
      instance.closeSync()
    },
  }
}
