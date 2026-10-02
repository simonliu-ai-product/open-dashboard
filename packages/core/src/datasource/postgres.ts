import type { PostgresSource, Row, TableInfo } from '../config.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { importPeer } from './peer.js'
import { type Datasource, DatasourceError } from './types.js'

interface PgField {
  name: string
}
interface PgResult {
  rows: Row[]
  fields: PgField[]
}
interface PgClient {
  query(text: string, values?: unknown[]): Promise<PgResult>
  release(): void
}
interface PgPool {
  connect(): Promise<PgClient>
  end(): Promise<void>
}
interface PgModule {
  Pool: new (options: Record<string, unknown>) => PgPool
  types: { setTypeParser(oid: number, parse: (value: string) => unknown): void }
}

const INT8 = 20
const NUMERIC = 1700
const DATE = 1082
const TIMESTAMP = 1114
const TIME = 1083

/**
 * Every query runs inside `BEGIN READ ONLY … ROLLBACK`, so a dashboard can never
 * write — even if someone points a datasource at a role that could.
 */
export async function openPostgres(
  name: string,
  config: PostgresSource,
  root: string,
): Promise<Datasource> {
  if (!config.url)
    throw new DatasourceError(`datasource "${name}": url is empty — is it set in .env?`, 500)
  const pg = await importPeer<PgModule>('pg', root, 'pg')
  pg.types.setTypeParser(INT8, (value) =>
    Number.isSafeInteger(Number(value)) ? Number(value) : value,
  )
  pg.types.setTypeParser(NUMERIC, (value) => Number(value))
  pg.types.setTypeParser(DATE, (value) => value)
  // Without a zone, keep the wall-clock text; parsing it would read it as the
  // server's local time and then print it shifted to UTC.
  pg.types.setTypeParser(TIMESTAMP, (value) => value)
  pg.types.setTypeParser(TIME, (value) => value)
  const pool = new pg.Pool({ connectionString: config.url, max: 4, ...config.options })

  const withClient = async <T>(timeoutMs: number, run: (client: PgClient) => Promise<T>) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`)
      return await run(client)
    } finally {
      await client.query('ROLLBACK').catch(() => {})
      client.release()
    }
  }

  return {
    name,
    type: 'postgres',
    async query(sql, params, options) {
      const started = performance.now()
      const compiled = compileParams(sql, 'dollar')
      const values = bindParams(compiled.names, params)
      const result = await withClient(options.timeoutMs, (client) =>
        client.query(compiled.text, values),
      )
      const truncated = result.rows.length > options.maxRows
      const normalized = normalizeRows(
        result.rows.slice(0, options.maxRows),
        result.fields.map((f) => f.name),
      )
      return { ...normalized, truncated, elapsedMs: performance.now() - started }
    },
    async schema() {
      return withClient(30_000, async (client) => {
        const { rows } = await client.query(`
          SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable,
                 t.table_type,
                 EXISTS (
                   SELECT 1 FROM information_schema.table_constraints tc
                   JOIN information_schema.key_column_usage k
                     ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                   WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema
                     AND tc.table_name = c.table_name AND k.column_name = c.column_name
                 ) AS is_pk
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
          WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
          ORDER BY c.table_schema, c.table_name, c.ordinal_position`)
        const fks = await client.query(`
          SELECT tc.table_schema, tc.table_name, k.column_name,
                 ccu.table_name AS ref_table, ccu.column_name AS ref_column
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage k
            ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'`)
        const counts = await client.query(`
          SELECT n.nspname AS table_schema, c.relname AS table_name, c.reltuples::bigint AS estimate
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind = 'r'`)
        return {
          source: name,
          type: 'postgres' as const,
          tables: groupTables(rows, fks.rows, counts.rows),
        }
      })
    },
    async close() {
      await pool.end()
    },
  }
}

export function groupTables(columns: Row[], fks: Row[], counts: Row[]): TableInfo[] {
  const tables = new Map<string, TableInfo>()
  const key = (schema: unknown, table: unknown) => `${schema}.${table}`
  for (const row of columns) {
    const id = key(row.table_schema, row.table_name)
    let table = tables.get(id)
    if (!table) {
      table = {
        name: String(row.table_name),
        schema: String(row.table_schema),
        kind: String(row.table_type).includes('VIEW') ? 'view' : 'table',
        columns: [],
        foreignKeys: [],
      }
      tables.set(id, table)
    }
    table.columns.push({
      name: String(row.column_name),
      type: String(row.data_type),
      nullable: row.is_nullable === 'YES',
      primaryKey: row.is_pk === true || row.is_pk === 1 || row.is_pk === '1',
    })
  }
  for (const fk of fks) {
    tables.get(key(fk.table_schema, fk.table_name))?.foreignKeys.push({
      column: String(fk.column_name),
      table: String(fk.ref_table),
      references: String(fk.ref_column),
    })
  }
  for (const count of counts) {
    const table = tables.get(key(count.table_schema, count.table_name))
    const estimate = Number(count.estimate)
    if (table && Number.isFinite(estimate) && estimate >= 0) table.rowCount = estimate
  }
  return [...tables.values()]
}
