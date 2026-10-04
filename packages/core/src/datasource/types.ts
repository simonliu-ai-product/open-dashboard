import type { DatasourceType, ParamValue, QueryResult, SchemaInfo } from '../config.js'
import { redact } from './redact.js'

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
  /** MCP only: the server and every tool it offers, for the data sources page. */
  tools?(): Promise<ToolCatalog>
  close(): Promise<void>
}

export interface ToolSummary {
  name: string
  title?: string
  /** The first line of its description. */
  description?: string
  /** Words to find it by: the rest of its description, shortened. */
  search?: string
  /** `readOnlyHint`, as the server annotated it — undefined when it says nothing. */
  readOnly?: boolean
  destructive?: boolean
}

export interface ToolCatalog {
  server?: { name?: string; version?: string }
  tools: ToolSummary[]
}

export class DatasourceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(redact(message))
  }
}

/**
 * Driver errors are not always readable: a refused connection on a dual-stack
 * host is an AggregateError with an empty message and the reasons inside.
 */
export function errorMessage(error: unknown): string {
  return redact(rawMessage(error))
}

function rawMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if (error.message) return error.message
  const inner = (error as { errors?: unknown[] }).errors
  if (Array.isArray(inner) && inner.length > 0)
    return [...new Set(inner.map(rawMessage))].join('; ')
  const code = (error as { code?: string }).code
  return code ?? error.name
}
