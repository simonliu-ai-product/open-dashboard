import type { DatasourceType, ParamValue, QueryResult, SchemaInfo } from '../config.js'

export interface QueryOptions {
  maxRows: number
  timeoutMs: number
}

export interface Datasource {
  readonly name: string
  readonly type: DatasourceType
  query(
    sql: string,
    params: Record<string, ParamValue>,
    options: QueryOptions,
  ): Promise<QueryResult>
  schema(): Promise<SchemaInfo>
  close(): Promise<void>
}

export class DatasourceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/**
 * Driver errors are not always readable: a refused connection on a dual-stack
 * host is an AggregateError with an empty message and the reasons inside.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if (error.message) return error.message
  const inner = (error as { errors?: unknown[] }).errors
  if (Array.isArray(inner) && inner.length > 0)
    return [...new Set(inner.map(errorMessage))].join('; ')
  const code = (error as { code?: string }).code
  return code ?? error.name
}
