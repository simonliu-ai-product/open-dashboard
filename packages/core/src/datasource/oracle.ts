import type { OracleSource, Row, TableInfo } from '../config.js'
import { assertReadOnlySql, foldUpperCase } from './guard.js'
import { normalizeRows, parseUrl, wallClock } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { importPeer } from './peer.js'
import { type Datasource, DatasourceError } from './types.js'

interface OracleMeta {
  name: string
  dbType?: unknown
}
interface OracleResult {
  rows?: Row[]
  metaData?: OracleMeta[]
}
interface OracleConnection {
  callTimeout: number
  execute(
    sql: string,
    binds?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<OracleResult>
  rollback(): Promise<void>
  close(): Promise<void>
}
interface OraclePool {
  getConnection(): Promise<OracleConnection>
  close(drainTime?: number): Promise<void>
}
interface OracleModule {
  createPool(options: Record<string, unknown>): Promise<OraclePool>
  OUT_FORMAT_OBJECT: number
  DB_TYPE_DATE: unknown
  DB_TYPE_TIMESTAMP: unknown
  DB_TYPE_TIMESTAMP_TZ: unknown
  DB_TYPE_TIMESTAMP_LTZ: unknown
}

/** `oracle://user:pass@host:1521/SERVICE`, or `user` + `password` + `connectString`. */
export function oracleCredentials(config: OracleSource): {
  user: string
  password: string
  connectString: string
} {
  if (config.url) {
    const { user, password, host, port, database } = parseUrl(config.url)
    return { user, password, connectString: `${host}:${port ?? 1521}/${database}` }
  }
  if (config.user && config.connectString) {
    return {
      user: config.user,
      password: config.password ?? '',
      connectString: config.connectString,
    }
  }
  throw new DatasourceError(
    'oracle needs url, or user + password + connectString — is it set in .env?',
    500,
  )
}

/**
 * `SET TRANSACTION READ ONLY` stops DML, but Oracle DDL commits implicitly and
 * would run anyway — hence the lexical check as well. The driver builds a DATE
 * or TIMESTAMP as a JavaScript Date in the client's zone, so its local fields
 * are the stored wall-clock time; those are what come back (a DATE at midnight
 * shortened to the day). Zoned timestamps are true instants and stay ISO.
 */
export async function openOracle(
  name: string,
  config: OracleSource,
  root: string,
): Promise<Datasource> {
  const credentials = oracleCredentials(config)
  const oracledb = await importPeer<OracleModule>('oracledb', root, 'oracledb')
  const pending = oracledb.createPool({ ...credentials, poolMin: 0, poolMax: 4, ...config.options })
  pending.catch(() => {})
  const zoned = new Set([oracledb.DB_TYPE_TIMESTAMP_TZ, oracledb.DB_TYPE_TIMESTAMP_LTZ])
  const owner = config.schema?.toUpperCase()

  const withConnection = async <T>(timeoutMs: number, run: (c: OracleConnection) => Promise<T>) => {
    const connection = await (await pending).getConnection()
    try {
      connection.callTimeout = timeoutMs
      await connection.execute('SET TRANSACTION READ ONLY')
      return await run(connection)
    } finally {
      await connection.rollback().catch(() => {})
      await connection.close().catch(() => {})
    }
  }

  const select = (
    connection: OracleConnection,
    text: string,
    binds: Record<string, unknown>,
    maxRows = 0,
  ) => connection.execute(text, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, maxRows })

  return {
    name,
    type: 'oracle',
    async query(text, params, options) {
      const started = performance.now()
      assertReadOnlySql(text, 'Oracle')
      const compiled = compileParams(text, (_, n) => `:p${n}`)
      const values = bindParams(compiled.names, params)
      const binds = Object.fromEntries(values.map((value, i) => [`p${i + 1}`, value]))
      const result = await withConnection(options.timeoutMs, (c) =>
        select(c, compiled.text, binds, options.maxRows + 1),
      )
      const meta = result.metaData ?? []
      const rows = (result.rows ?? []).slice(0, options.maxRows).map((row) => {
        const out: Row = {}
        for (const column of meta) {
          const value = row[column.name]
          out[foldUpperCase(column.name)] = !(value instanceof Date)
            ? value
            : zoned.has(column.dbType)
              ? value.toISOString()
              : wallClock(value, 'datetime', 'local').replace(
                  column.dbType === oracledb.DB_TYPE_DATE ? / 00:00:00$/ : /^$/,
                  '',
                )
        }
        return out
      })
      return {
        ...normalizeRows(
          rows,
          meta.map((c) => foldUpperCase(c.name)),
        ),
        truncated: (result.rows?.length ?? 0) > options.maxRows,
        elapsedMs: performance.now() - started,
      }
    },
    async schema() {
      return withConnection(30_000, async (c) => {
        const scope = owner ? 'ALL' : 'USER'
        const where = owner ? 'WHERE c.OWNER = :owner' : ''
        const binds: Record<string, unknown> = owner ? { owner } : {}
        const columns = await select(
          c,
          `SELECT c.TABLE_NAME AS "table_name", c.COLUMN_NAME AS "column_name", c.DATA_TYPE AS "data_type",
                  c.NULLABLE AS "nullable"
           FROM ${scope}_TAB_COLUMNS c ${where}
           ORDER BY c.TABLE_NAME, c.COLUMN_ID`,
          binds,
        )
        const keys = await select(
          c,
          `SELECT con.CONSTRAINT_TYPE AS "kind", col.TABLE_NAME AS "table_name", col.COLUMN_NAME AS "column_name",
                  rcol.TABLE_NAME AS "ref_table", rcol.COLUMN_NAME AS "ref_column"
           FROM ${scope}_CONSTRAINTS con
           JOIN ${scope}_CONS_COLUMNS col ON col.CONSTRAINT_NAME = con.CONSTRAINT_NAME ${owner ? 'AND col.OWNER = con.OWNER' : ''}
           LEFT JOIN ${scope}_CONS_COLUMNS rcol ON rcol.CONSTRAINT_NAME = con.R_CONSTRAINT_NAME
             AND rcol.POSITION = col.POSITION ${owner ? 'AND rcol.OWNER = con.R_OWNER' : ''}
           WHERE con.CONSTRAINT_TYPE IN ('P', 'R') ${owner ? 'AND con.OWNER = :owner' : ''}`,
          binds,
        )
        const objects = await select(
          c,
          `SELECT OBJECT_NAME AS "name", OBJECT_TYPE AS "kind" FROM ${scope}_OBJECTS
           WHERE OBJECT_TYPE IN ('TABLE', 'VIEW') ${owner ? 'AND OWNER = :owner' : ''}`,
          binds,
        )
        const counts = await select(
          c,
          `SELECT TABLE_NAME AS "table_name", NUM_ROWS AS "estimate" FROM ${scope}_TABLES ${owner ? 'WHERE OWNER = :owner' : ''}`,
          binds,
        )
        const kinds = new Map(
          (objects.rows ?? []).map((r) => [String(r.name), r.kind === 'VIEW' ? 'view' : 'table']),
        )
        const estimates = new Map(
          (counts.rows ?? []).map((r) => [String(r.table_name), r.estimate]),
        )
        const primary = new Set(
          (keys.rows ?? [])
            .filter((k) => k.kind === 'P')
            .map((k) => `${k.table_name}.${k.column_name}`),
        )
        const tables = new Map<string, TableInfo>()
        for (const row of columns.rows ?? []) {
          const tableName = String(row.table_name)
          if (tableName.startsWith('BIN$')) continue
          let table = tables.get(tableName)
          if (!table) {
            table = {
              name: tableName,
              kind: (kinds.get(tableName) ?? 'table') as 'table' | 'view',
              columns: [],
              foreignKeys: [],
            }
            if (owner) table.schema = owner
            const estimate = estimates.get(tableName)
            if (typeof estimate === 'number') table.rowCount = estimate
            tables.set(tableName, table)
          }
          table.columns.push({
            name: String(row.column_name),
            type: String(row.data_type),
            nullable: row.nullable === 'Y',
            primaryKey: primary.has(`${tableName}.${row.column_name}`),
          })
        }
        for (const key of keys.rows ?? []) {
          if (key.kind !== 'R') continue
          tables.get(String(key.table_name))?.foreignKeys.push({
            column: String(key.column_name),
            table: String(key.ref_table),
            references: String(key.ref_column),
          })
        }
        return { source: name, type: 'oracle' as const, tables: [...tables.values()] }
      })
    },
    async close() {
      await (await pending.catch(() => undefined))?.close(0).catch(() => {})
    },
  }
}
