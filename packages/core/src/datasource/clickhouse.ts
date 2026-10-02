import type { ClickhouseSource, ParamValue, Row, TableInfo } from '../config.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { importPeer } from './peer.js'
import { type Datasource, DatasourceError } from './types.js'

interface ClickhouseResultSet {
  json<T>(): Promise<T>
}
interface ClickhouseClient {
  query(options: {
    query: string
    format: 'JSON'
    query_params?: Record<string, unknown>
    clickhouse_settings?: Record<string, unknown>
  }): Promise<ClickhouseResultSet>
  close(): Promise<void>
}
interface ClickhouseModule {
  createClient(options: Record<string, unknown>): ClickhouseClient
}
interface JsonResult {
  meta: { name: string; type: string }[]
  data: Row[]
}

/** ClickHouse parameters are typed; the type follows the value bound. */
export function clickhouseType(value: ParamValue): string {
  if (value === null) return 'Nullable(String)'
  if (typeof value === 'boolean') return 'Bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int64' : 'Float64'
  return 'String'
}

/**
 * `readonly = 2` refuses every write but, unlike `1`, still lets this request
 * carry its own settings (timeout, row cap, number formatting).
 */
export async function openClickhouse(
  name: string,
  config: ClickhouseSource,
  root: string,
): Promise<Datasource> {
  if (!config.url)
    throw new DatasourceError(`datasource "${name}": url is empty — is it set in .env?`, 500)
  const { createClient } = await importPeer<ClickhouseModule>(
    '@clickhouse/client',
    root,
    '@clickhouse/client',
  )
  const client = createClient({ url: config.url, ...config.options })

  const run = (query: string, params: Record<string, unknown>, settings: Record<string, unknown>) =>
    client
      .query({
        query,
        format: 'JSON',
        query_params: params,
        clickhouse_settings: {
          readonly: '2',
          output_format_json_quote_decimals: 0,
          output_format_json_quote_64bit_floats: 0,
          ...settings,
        },
      })
      .then((rs) => rs.json<JsonResult>())

  return {
    name,
    type: 'clickhouse',
    async query(text, params, options) {
      const started = performance.now()
      const values: Record<string, ParamValue> = {}
      const compiled = compileParams(text, (_, n) => `{p${n}:__P${n}__}`)
      const bound = bindParams(compiled.names, params)
      let query = compiled.text
      bound.forEach((value, i) => {
        values[`p${i + 1}`] = value
        query = query.replaceAll(`__P${i + 1}__`, clickhouseType(value))
      })
      const result = await run(query, values, {
        max_execution_time: Math.max(1, Math.ceil(options.timeoutMs / 1000)),
        max_result_rows: options.maxRows + 1,
        result_overflow_mode: 'break',
      })
      // 64-bit integers arrive quoted — JSON.parse would round them — and are
      // turned into numbers here only where that is exact.
      const wide = result.meta
        .filter((m) => /^(Nullable\()?U?Int(64|128|256)\b/.test(m.type))
        .map((m) => m.name)
      const rows = result.data.slice(0, options.maxRows).map((row) => {
        if (wide.length === 0) return row
        const out: Row = { ...row }
        for (const column of wide) {
          const value = out[column]
          if (typeof value === 'string' && Number.isSafeInteger(Number(value)))
            out[column] = Number(value)
        }
        return out
      })
      return {
        ...normalizeRows(
          rows,
          result.meta.map((m) => m.name),
        ),
        truncated: result.data.length > options.maxRows,
        elapsedMs: performance.now() - started,
      }
    },
    async schema() {
      const columns = await run(
        `SELECT c.table, c.name, c.type, c.is_in_primary_key, t.engine, t.total_rows
         FROM system.columns c
         JOIN system.tables t ON t.database = c.database AND t.name = c.table
         WHERE c.database = currentDatabase()
         ORDER BY c.table, c.position`,
        {},
        {},
      )
      const tables = new Map<string, TableInfo>()
      for (const row of columns.data) {
        const tableName = String(row.table)
        let table = tables.get(tableName)
        if (!table) {
          table = {
            name: tableName,
            kind: String(row.engine).includes('View') ? 'view' : 'table',
            columns: [],
            foreignKeys: [],
          }
          if (row.total_rows !== null && row.total_rows !== undefined)
            table.rowCount = Number(row.total_rows)
          tables.set(tableName, table)
        }
        const type = String(row.type)
        table.columns.push({
          name: String(row.name),
          type,
          nullable: type.startsWith('Nullable('),
          primaryKey: row.is_in_primary_key === 1 || row.is_in_primary_key === true,
        })
      }
      return { source: name, type: 'clickhouse' as const, tables: [...tables.values()] }
    },
    async close() {
      await client.close()
    },
  }
}
