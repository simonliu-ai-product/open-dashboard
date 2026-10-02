import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Row, SnowflakeSource, TableInfo } from '../config.js'
import { assertReadOnlySql, foldUpperCase } from './guard.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { importPeer } from './peer.js'
import { type Datasource, DatasourceError } from './types.js'

interface SfColumn {
  getName(): string
}
interface SfStatement {
  getColumns(): SfColumn[] | undefined
}
interface SfConnection {
  execute(options: {
    sqlText: string
    binds?: unknown[]
    fetchAsString?: string[]
    complete: (error: Error | undefined, statement: SfStatement, rows: Row[] | undefined) => void
  }): void
}
interface SfPool {
  use<T>(task: (connection: SfConnection) => Promise<T>): Promise<T>
  drain(): Promise<void>
  clear(): Promise<void>
}
interface SfModule {
  configure(options: Record<string, unknown>): void
  createPool(options: Record<string, unknown>, poolOptions: Record<string, unknown>): SfPool
}

const SESSION = [
  "ALTER SESSION SET DATE_OUTPUT_FORMAT = 'YYYY-MM-DD'",
  "ALTER SESSION SET TIMESTAMP_NTZ_OUTPUT_FORMAT = 'YYYY-MM-DD HH24:MI:SS'",
  'ALTER SESSION SET TIMESTAMP_LTZ_OUTPUT_FORMAT = \'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM\'',
  'ALTER SESSION SET TIMESTAMP_TZ_OUTPUT_FORMAT = \'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM\'',
  "ALTER SESSION SET TIME_OUTPUT_FORMAT = 'HH24:MI:SS'",
]

/**
 * Snowflake has no read-only transaction, so queries pass the lexical check;
 * the real protection is a role granted only SELECT, which the connect skill
 * asks for. Unquoted aliases come back upper-cased and are folded down.
 */
export async function openSnowflake(
  name: string,
  config: SnowflakeSource,
  root: string,
): Promise<Datasource> {
  if (!config.account || !config.username) {
    throw new DatasourceError(
      `datasource "${name}": snowflake needs account and username — is it set in .env?`,
      500,
    )
  }
  const snowflake = await importPeer<SfModule>('snowflake-sdk', root, 'snowflake-sdk')
  snowflake.configure({ logLevel: 'ERROR' })
  const { options, privateKeyPath, ...connection } = config
  const pool = snowflake.createPool(
    {
      ...connection,
      ...(privateKeyPath
        ? {
            authenticator: 'SNOWFLAKE_JWT',
            privateKey: readFileSync(resolve(root, privateKeyPath), 'utf8'),
          }
        : {}),
      application: 'open-dashboard',
      ...options,
    },
    { max: 4, min: 0 },
  )
  const prepared = new WeakSet<SfConnection>()

  const execute = (c: SfConnection, sqlText: string, binds: unknown[] = []) =>
    new Promise<{ rows: Row[]; columns: string[] }>((done, fail) => {
      c.execute({
        sqlText,
        binds,
        fetchAsString: ['Date'],
        complete: (error, statement, rows) => {
          if (error) fail(error)
          else
            done({
              rows: rows ?? [],
              columns: statement.getColumns()?.map((col) => col.getName()) ?? [],
            })
        },
      })
    })

  const run = (sqlText: string, binds: unknown[], timeoutMs: number) =>
    pool.use(async (c) => {
      if (!prepared.has(c)) {
        for (const statement of SESSION) await execute(c, statement)
        prepared.add(c)
      }
      await execute(
        c,
        `ALTER SESSION SET STATEMENT_TIMEOUT_IN_SECONDS = ${Math.max(1, Math.ceil(timeoutMs / 1000))}`,
      )
      return execute(c, sqlText, binds)
    })

  return {
    name,
    type: 'snowflake',
    async query(text, params, options) {
      const started = performance.now()
      assertReadOnlySql(text, 'Snowflake')
      const compiled = compileParams(text, 'question')
      const values = bindParams(compiled.names, params)
      const result = await run(compiled.text, values, options.timeoutMs)
      const names = result.columns.map(foldUpperCase)
      const rows = result.rows.slice(0, options.maxRows).map((row) => {
        const out: Row = {}
        result.columns.forEach((column, i) => {
          out[names[i] as string] = row[column]
        })
        return out
      })
      return {
        ...normalizeRows(rows, names),
        truncated: result.rows.length > options.maxRows,
        elapsedMs: performance.now() - started,
      }
    },
    async schema() {
      const { rows } = await run(
        `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable, t.table_type, t.row_count
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema <> 'INFORMATION_SCHEMA'
         ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
        [],
        60_000,
      )
      const tables = new Map<string, TableInfo>()
      for (const row of rows) {
        const id = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`
        let table = tables.get(id)
        if (!table) {
          table = {
            name: String(row.TABLE_NAME),
            schema: String(row.TABLE_SCHEMA),
            kind: String(row.TABLE_TYPE).includes('VIEW') ? 'view' : 'table',
            columns: [],
            foreignKeys: [],
          }
          if (row.ROW_COUNT !== null && row.ROW_COUNT !== undefined)
            table.rowCount = Number(row.ROW_COUNT)
          tables.set(id, table)
        }
        table.columns.push({
          name: String(row.COLUMN_NAME),
          type: String(row.DATA_TYPE),
          nullable: row.IS_NULLABLE === 'YES',
          primaryKey: false,
        })
      }
      return { source: name, type: 'snowflake' as const, tables: [...tables.values()] }
    },
    async close() {
      await pool.drain().catch(() => {})
      await pool.clear().catch(() => {})
    },
  }
}
