import type { MysqlSource, Row } from '../config.js'
import { assertReadOnlySql } from './guard.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { importPeer } from './peer.js'
import { groupTables } from './postgres.js'
import { type Datasource, DatasourceError } from './types.js'

interface MysqlConnection {
  query(
    options: string | { sql: string; timeout?: number },
    values?: unknown[],
  ): Promise<[unknown, { name: string }[]]>
  release(): void
}
interface MysqlPool {
  getConnection(): Promise<MysqlConnection>
  end(): Promise<void>
}
interface MysqlModule {
  createPool(options: Record<string, unknown>): MysqlPool
}

export async function openMysql(
  name: string,
  config: MysqlSource,
  root: string,
): Promise<Datasource> {
  if (!config.url)
    throw new DatasourceError(`datasource "${name}": url is empty — is it set in .env?`, 500)
  const mysql = await importPeer<MysqlModule>('mysql2/promise', root, 'mysql2')
  const pool = mysql.createPool({
    uri: config.url,
    connectionLimit: 4,
    decimalNumbers: true,
    dateStrings: true,
    supportBigNumbers: true,
    ...config.options,
  })

  const withConnection = async <T>(run: (connection: MysqlConnection) => Promise<T>) => {
    const connection = await pool.getConnection()
    try {
      await connection.query('START TRANSACTION READ ONLY')
      return await run(connection)
    } finally {
      await connection.query('ROLLBACK').catch(() => {})
      connection.release()
    }
  }

  return {
    name,
    type: 'mysql',
    async query(sql, params, options) {
      const started = performance.now()
      // MySQL commits DDL implicitly, which ends the READ ONLY transaction and
      // runs the statement anyway — the transaction alone does not stop CREATE.
      assertReadOnlySql(sql, 'MySQL')
      const compiled = compileParams(sql, 'question')
      const values = bindParams(compiled.names, params)
      const [rows, fields] = await withConnection((connection) =>
        connection.query({ sql: compiled.text, timeout: options.timeoutMs }, values),
      )
      const list = Array.isArray(rows) ? (rows as Row[]) : []
      const normalized = normalizeRows(
        list.slice(0, options.maxRows),
        (fields ?? []).map((f) => f.name),
      )
      return {
        ...normalized,
        truncated: list.length > options.maxRows,
        elapsedMs: performance.now() - started,
      }
    },
    async schema() {
      return withConnection(async (connection) => {
        const [columns] = await connection.query(`
          SELECT c.TABLE_SCHEMA AS table_schema, c.TABLE_NAME AS table_name,
                 c.COLUMN_NAME AS column_name, c.COLUMN_TYPE AS data_type,
                 c.IS_NULLABLE AS is_nullable, t.TABLE_TYPE AS table_type,
                 c.COLUMN_KEY = 'PRI' AS is_pk
          FROM information_schema.COLUMNS c
          JOIN information_schema.TABLES t
            ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = DATABASE()
          ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`)
        const [fks] = await connection.query(`
          SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
                 REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_column
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`)
        const [counts] = await connection.query(`
          SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, TABLE_ROWS AS estimate
          FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`)
        return {
          source: name,
          type: 'mysql' as const,
          tables: groupTables(columns as Row[], fks as Row[], counts as Row[]).map(
            ({ schema: _, ...table }) => table,
          ),
        }
      })
    },
    async close() {
      await pool.end()
    },
  }
}
