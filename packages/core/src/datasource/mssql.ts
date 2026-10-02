import type { MssqlSource, Row } from '../config.js'
import { assertReadOnlySql } from './guard.js'
import { normalizeRows, parseUrl, wallClock } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { importPeer } from './peer.js'
import { groupTables } from './postgres.js'
import { type Datasource, DatasourceError } from './types.js'

type SqlType = unknown
interface MssqlColumn {
  name: string
  type: SqlType
}
interface MssqlResult {
  recordset?: Row[] & { columns?: Record<string, MssqlColumn> }
}
interface MssqlRequest {
  input(name: string, value: unknown): MssqlRequest
  query(sql: string): Promise<MssqlResult>
}
interface MssqlTransaction {
  begin(): Promise<unknown>
  rollback(): Promise<unknown>
}
interface MssqlPool {
  connect(): Promise<MssqlPool>
  close(): Promise<void>
}
interface MssqlModule {
  ConnectionPool: (new (
    config: Record<string, unknown>,
  ) => MssqlPool) & {
    parseConnectionString(text: string): Record<string, unknown>
  }
  Transaction: new (pool: MssqlPool) => MssqlTransaction
  Request: new (parent: MssqlTransaction) => MssqlRequest
  TYPES: Record<string, SqlType>
}

const BOOLEAN_PARAMS = new Set(['encrypt', 'trustServerCertificate', 'trustservercertificate'])

/** `mssql://` / `sqlserver://` URLs, or an ADO.NET string (`Server=…;Database=…`). */
export function mssqlConfig(
  url: string,
  parse: MssqlModule['ConnectionPool']['parseConnectionString'],
) {
  if (!/^(mssql|sqlserver):\/\//i.test(url)) return parse(url)
  const { user, password, host, port, database, params } = parseUrl(url)
  const options: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    options[key === 'trustservercertificate' ? 'trustServerCertificate' : key] = BOOLEAN_PARAMS.has(
      key,
    )
      ? value === 'true'
      : value
  }
  return { user, password, server: host, ...(port ? { port } : {}), database, options }
}

/**
 * SQL Server has no read-only transaction. Every query runs inside one that is
 * always rolled back, after a lexical check that refuses anything but a single
 * SELECT — and a read-only login is still the real protection.
 */
export async function openMssql(
  name: string,
  config: MssqlSource,
  root: string,
): Promise<Datasource> {
  if (!config.url)
    throw new DatasourceError(`datasource "${name}": url is empty — is it set in .env?`, 500)
  const sql = await importPeer<MssqlModule>('mssql', root, 'mssql')
  const base = mssqlConfig(config.url, sql.ConnectionPool.parseConnectionString) as {
    options?: Record<string, unknown>
  }
  const pool = new sql.ConnectionPool({
    ...base,
    ...config.options,
    options: { ...base.options, useUTC: true, ...(config.options?.options as object | undefined) },
    pool: { max: 4 },
  })
  const connected = pool.connect()
  connected.catch(() => {})

  const { TYPES } = sql
  const asDate = new Set([TYPES.Date])
  const asTime = new Set([TYPES.Time])
  const asInstant = new Set([TYPES.DateTimeOffset])
  const asNumber = new Set([
    TYPES.BigInt,
    TYPES.Decimal,
    TYPES.Numeric,
    TYPES.Money,
    TYPES.SmallMoney,
  ])

  const run = async (text: string, inputs: [string, unknown][], timeoutMs: number) => {
    await connected
    const tx = new sql.Transaction(pool)
    await tx.begin()
    try {
      const request = new sql.Request(tx) as MssqlRequest & { timeout?: number }
      request.timeout = timeoutMs
      for (const [key, value] of inputs) request.input(key, value)
      return await request.query(text)
    } finally {
      await tx.rollback().catch(() => {})
    }
  }

  return {
    name,
    type: 'mssql',
    async query(text, params, options) {
      const started = performance.now()
      assertReadOnlySql(text, 'SQL Server')
      const compiled = compileParams(text, (_, n) => `@p${n}`)
      const values = bindParams(compiled.names, params)
      const result = await run(
        compiled.text,
        values.map((value, i) => [`p${i + 1}`, value]),
        options.timeoutMs,
      )
      const recordset = (result.recordset ?? []) as Row[] & {
        columns?: Record<string, MssqlColumn>
      }
      const columns = Object.values(recordset.columns ?? {})
      const rows = recordset.slice(0, options.maxRows).map((row) => {
        const out: Row = { ...row }
        for (const column of columns) {
          const value = out[column.name]
          if (value instanceof Date) {
            out[column.name] = asInstant.has(column.type)
              ? value.toISOString()
              : wallClock(
                  value,
                  asDate.has(column.type) ? 'date' : asTime.has(column.type) ? 'time' : 'datetime',
                )
          } else if (typeof value === 'string' && asNumber.has(column.type)) {
            const n = Number(value)
            out[column.name] = column.type === TYPES.BigInt && !Number.isSafeInteger(n) ? value : n
          }
        }
        return out
      })
      const names = columns.length ? columns.map((c) => c.name) : Object.keys(rows[0] ?? {})
      return {
        ...normalizeRows(rows, names),
        truncated: recordset.length > options.maxRows,
        elapsedMs: performance.now() - started,
      }
    },
    async schema() {
      const columns = await run(
        `SELECT c.TABLE_SCHEMA AS table_schema, c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name,
                c.DATA_TYPE AS data_type, c.IS_NULLABLE AS is_nullable, t.TABLE_TYPE AS table_type,
                CASE WHEN EXISTS (
                  SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                  JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
                    ON k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.TABLE_SCHEMA = tc.TABLE_SCHEMA
                  WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = c.TABLE_SCHEMA
                    AND tc.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME
                ) THEN 1 ELSE 0 END AS is_pk
         FROM INFORMATION_SCHEMA.COLUMNS c
         JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
         WHERE c.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
         ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
        [],
        30_000,
      )
      const fks = await run(
        `SELECT fk_s.name AS table_schema, fk_t.name AS table_name, fk_c.name AS column_name,
                pk_t.name AS ref_table, pk_c.name AS ref_column
         FROM sys.foreign_key_columns f
         JOIN sys.tables fk_t ON fk_t.object_id = f.parent_object_id
         JOIN sys.schemas fk_s ON fk_s.schema_id = fk_t.schema_id
         JOIN sys.columns fk_c ON fk_c.object_id = f.parent_object_id AND fk_c.column_id = f.parent_column_id
         JOIN sys.tables pk_t ON pk_t.object_id = f.referenced_object_id
         JOIN sys.columns pk_c ON pk_c.object_id = f.referenced_object_id AND pk_c.column_id = f.referenced_column_id`,
        [],
        30_000,
      )
      const counts = await run(
        `SELECT s.name AS table_schema, t.name AS table_name, SUM(p.rows) AS estimate
         FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
         JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
         GROUP BY s.name, t.name`,
        [],
        30_000,
      )
      const tables = groupTables(
        (columns.recordset ?? []) as Row[],
        (fks.recordset ?? []) as Row[],
        (counts.recordset ?? []) as Row[],
      ).map((table) => (table.schema === 'dbo' ? { ...table, schema: undefined } : table))
      return {
        source: name,
        type: 'mssql',
        tables: tables.map(({ schema, ...t }) => (schema ? { ...t, schema } : t)),
      }
    },
    async close() {
      await pool.close().catch(() => {})
    },
  }
}
