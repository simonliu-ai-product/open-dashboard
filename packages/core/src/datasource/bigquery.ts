import type { BigquerySource, ParamValue, Row, TableInfo } from '../config.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { importPeer } from './peer.js'
import { type Datasource, DatasourceError } from './types.js'

interface BqField {
  name: string
  type?: string
}
interface BqJob {
  metadata: { statistics?: { query?: { statementType?: string; totalBytesProcessed?: string } } }
  getQueryResults(
    options?: Record<string, unknown>,
  ): Promise<[Row[], unknown, { schema?: { fields?: BqField[] }; totalRows?: string }]>
}
interface BqClient {
  createQueryJob(options: Record<string, unknown>): Promise<[BqJob, unknown]>
  getDatasets(): Promise<[{ id?: string }[]]>
}
interface BqModule {
  BigQuery: new (options: Record<string, unknown>) => BqClient
}

export const DEFAULT_MAX_BYTES = 10 * 1024 ** 3

/** BigQuery's own value wrappers (dates, timestamps, NUMERIC, wrapped INT64) → plain values. */
export function bigqueryValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return JSON.stringify(value.map(bigqueryValue))
  const ctor = (value as { constructor?: { name?: string } }).constructor?.name
  if (ctor === 'BigQueryInt') {
    const n = Number((value as { value: string }).value)
    return Number.isSafeInteger(n) ? n : (value as { value: string }).value
  }
  if (ctor === 'Big') return Number(String(value))
  if ('value' in value && typeof (value as { value: unknown }).value === 'string') {
    return (value as { value: string }).value
  }
  return JSON.stringify(value)
}

function bytes(n: number): string {
  return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`
}

/**
 * BigQuery has no read-only session, and every query costs money. Each query
 * is dry-run first: it must be a SELECT, and its scan must fit under
 * `maximumBytesBilled` (10 GiB unless configured), which is also set on the
 * real job so BigQuery itself refuses to bill more.
 */
export async function openBigquery(
  name: string,
  config: BigquerySource,
  root: string,
): Promise<Datasource> {
  if (!config.projectId)
    throw new DatasourceError(`datasource "${name}": projectId is required`, 500)
  const { BigQuery } = await importPeer<BqModule>(
    '@google-cloud/bigquery',
    root,
    '@google-cloud/bigquery',
  )
  const client = new BigQuery({
    projectId: config.projectId,
    ...(config.keyFilename ? { keyFilename: config.keyFilename } : {}),
    ...(config.credentials ? { credentials: config.credentials } : {}),
    ...(config.location ? { location: config.location } : {}),
    ...config.options,
  })
  const maxBytes = config.maximumBytesBilled ?? DEFAULT_MAX_BYTES
  const defaultDataset = config.dataset
    ? { projectId: config.projectId, datasetId: config.dataset }
    : undefined

  const job = (
    query: string,
    params: Record<string, ParamValue>,
    extra: Record<string, unknown> = {},
  ) => {
    const types: Record<string, string> = {}
    for (const [key, value] of Object.entries(params)) if (value === null) types[key] = 'STRING'
    return client.createQueryJob({
      query,
      useLegacySql: false,
      params,
      ...(Object.keys(types).length ? { types } : {}),
      ...(config.location ? { location: config.location } : {}),
      ...(defaultDataset ? { defaultDataset } : {}),
      ...extra,
    })
  }

  const read = async (
    query: string,
    params: Record<string, ParamValue>,
    maxRows: number,
    timeoutMs: number,
  ) => {
    const [dry] = await job(query, params, { dryRun: true })
    const stats = dry.metadata.statistics?.query
    if (stats?.statementType && stats.statementType !== 'SELECT') {
      throw new DatasourceError(
        `BigQuery: only SELECT can run here (this is ${stats.statementType})`,
      )
    }
    const scanned = Number(stats?.totalBytesProcessed ?? 0)
    if (scanned > maxBytes) {
      throw new DatasourceError(
        `BigQuery: this query would scan ${bytes(scanned)}, over the ${bytes(maxBytes)} limit — filter on the partition column, select fewer columns, or raise maximumBytesBilled`,
      )
    }
    const [running] = await job(query, params, {
      maximumBytesBilled: String(maxBytes),
      jobTimeoutMs: timeoutMs,
    })
    const [rows, , response] = await running.getQueryResults({
      maxResults: maxRows + 1,
      autoPaginate: false,
      wrapIntegers: true,
      timeoutMs,
    })
    const names = response?.schema?.fields?.map((f) => f.name) ?? Object.keys(rows[0] ?? {})
    const plain = rows.map((row) =>
      Object.fromEntries(names.map((n) => [n, bigqueryValue(row[n])])),
    )
    return { rows: plain, names, total: Number(response?.totalRows ?? rows.length) }
  }

  return {
    name,
    type: 'bigquery',
    async query(text, params, options) {
      const started = performance.now()
      const compiled = compileParams(text, (_, n) => `@p${n}`)
      const values = bindParams(compiled.names, params)
      const named = Object.fromEntries(values.map((value, i) => [`p${i + 1}`, value]))
      const result = await read(compiled.text, named, options.maxRows, options.timeoutMs)
      return {
        ...normalizeRows(result.rows.slice(0, options.maxRows), result.names),
        truncated: result.total > options.maxRows,
        elapsedMs: performance.now() - started,
      }
    },
    async schema() {
      let datasets = config.datasets ?? (config.dataset ? [config.dataset] : [])
      if (datasets.length === 0) {
        const [found] = await client.getDatasets()
        datasets = found
          .map((d) => d.id ?? '')
          .filter(Boolean)
          .slice(0, 20)
      }
      const tables: TableInfo[] = []
      for (const dataset of datasets) {
        const ref = `\`${config.projectId}.${dataset}\``
        const columns = await read(
          `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, t.table_type
           FROM ${ref}.INFORMATION_SCHEMA.COLUMNS c
           JOIN ${ref}.INFORMATION_SCHEMA.TABLES t USING (table_name)
           ORDER BY c.table_name, c.ordinal_position`,
          {},
          100_000,
          60_000,
        )
        const counts = await read(
          `SELECT table_id, row_count FROM ${ref}.__TABLES__`,
          {},
          100_000,
          60_000,
        ).catch(() => ({ rows: [] as Row[] }))
        const rowCounts = new Map(counts.rows.map((r) => [String(r.table_id), Number(r.row_count)]))
        const byTable = new Map<string, TableInfo>()
        for (const row of columns.rows) {
          const tableName = String(row.table_name)
          let table = byTable.get(tableName)
          if (!table) {
            table = {
              name: tableName,
              schema: dataset,
              kind: String(row.table_type).includes('VIEW') ? 'view' : 'table',
              columns: [],
              foreignKeys: [],
            }
            const count = rowCounts.get(tableName)
            if (count !== undefined && Number.isFinite(count)) table.rowCount = count
            byTable.set(tableName, table)
          }
          table.columns.push({
            name: String(row.column_name),
            type: String(row.data_type),
            nullable: row.is_nullable === 'YES',
            primaryKey: false,
          })
        }
        tables.push(...byTable.values())
      }
      return { source: name, type: 'bigquery' as const, tables }
    },
    async close() {},
  }
}
