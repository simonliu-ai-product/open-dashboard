import type { SchemaInfo } from '../config.js'
import { tableFiles } from '../datasource/files.js'
import { redact, redactValue } from '../datasource/redact.js'
import { errorMessage, type ToolCatalog, type ToolSummary } from '../datasource/types.js'
import type { Workspace } from '../workspace.js'
import { OpsError } from './errors.js'

export interface SourceStatus {
  name: string
  type: string
  default: boolean
  ok: boolean
  error?: string
  tables?: number
}

export async function listSources(workspace: Workspace): Promise<SourceStatus[]> {
  return Promise.all(
    Object.entries(workspace.config.datasources).map(async ([name, config]) => {
      const status: SourceStatus = {
        name,
        type: config.type,
        default: workspace.config.defaultSource === name,
        ok: false,
      }
      try {
        const schema = await (await workspace.source(name)).schema()
        status.ok = true
        status.tables = schema.tables.length
      } catch (error) {
        status.error = errorMessage(error)
      }
      return status
    }),
  )
}

export async function readSchema(workspace: Workspace, source?: string): Promise<SchemaInfo> {
  return (await workspace.source(source)).schema()
}

/** Written for an agent to read before writing SQL: compact, every column, keys marked. */
export function schemaToText(schema: SchemaInfo): string {
  const lines = [`# ${schema.source} (${schema.type}) — ${schema.tables.length} tables/views`, '']
  for (const table of schema.tables) {
    const qualified =
      table.schema && table.schema !== 'public' ? `${table.schema}.${table.name}` : table.name
    const count =
      table.rowCount !== undefined ? `, ${table.rowCount.toLocaleString('en-US')} rows` : ''
    lines.push(`## ${qualified} (${table.kind}${count})`)
    for (const column of table.columns) {
      const flags = [
        column.primaryKey ? 'PK' : '',
        column.nullable ? '' : 'NOT NULL',
        ...table.foreignKeys
          .filter((fk) => fk.column === column.name)
          .map((fk) => `→ ${fk.table}.${fk.references}`),
      ].filter(Boolean)
      lines.push(`- ${column.name}  ${column.type}${flags.length ? `  ${flags.join(' ')}` : ''}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** The `:name` parameters a table's URL or arguments need. */
function placeholders(value: unknown): string[] {
  const text = JSON.stringify(value ?? '')
  return [...new Set([...text.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1] as string))]
}

export interface HttpEndpoint {
  table: string
  method: 'GET'
  url: string
  rows?: string
  cache: string
  params: string[]
}

export interface McpToolTable {
  table: string
  tool: string
  args: Record<string, unknown>
  rows?: string
  cache: string
  params: string[]
  readOnly?: boolean
  destructive?: boolean
  title?: string
}

export type SourceDetail =
  | { kind: 'database' }
  | {
      kind: 'files'
      format: 'json' | 'csv'
      tables: { table: string; file: string; rows?: string; files: number }[]
    }
  | { kind: 'http'; base?: string; headers: string[]; endpoints: HttpEndpoint[] }
  | {
      kind: 'mcp'
      transport: 'http' | 'stdio'
      endpoint: string
      headers: string[]
      allowUnannotated: boolean
      server?: { name?: string; version?: string }
      tables: McpToolTable[]
      tools: ToolSummary[]
      error?: string
    }

/**
 * What an API or MCP source is made of, for the data sources page. Only what
 * is safe to show: URLs and arguments masked like any message, header names
 * without their values, a stdio command without its environment.
 */
export async function describeSource(workspace: Workspace, name: string): Promise<SourceDetail> {
  const config = workspace.config.datasources[name]
  if (!config) throw new OpsError(`unknown datasource "${name}"`, 404)
  if (config.type === 'http') {
    return {
      kind: 'http',
      ...(config.baseUrl ? { base: redact(config.baseUrl) } : {}),
      headers: Object.keys(config.headers ?? {}),
      endpoints: Object.entries(config.tables ?? {}).map(([table, spec]) => ({
        table,
        method: 'GET',
        url: redact(spec.url),
        ...(spec.rows ? { rows: spec.rows } : {}),
        cache: spec.cache ?? '30s',
        params: placeholders(spec.url),
      })),
    }
  }
  if (config.type === 'json' || config.type === 'csv') {
    return {
      kind: 'files',
      format: config.type,
      tables: Object.entries(config.tables ?? {}).map(([table, spec]) => {
        let files = 0
        try {
          files = tableFiles(workspace.config.root, spec.file).length
        } catch {
          // a pattern outside the workspace: the query reports why
        }
        return { table, file: spec.file, ...(spec.rows ? { rows: spec.rows } : {}), files }
      }),
    }
  }
  if (config.type !== 'mcp') return { kind: 'database' }

  let catalog: ToolCatalog = { tools: [] }
  let error: string | undefined
  try {
    catalog = (await (await workspace.source(name)).tools?.()) ?? catalog
  } catch (e) {
    error = errorMessage(e)
  }
  const byName = new Map(catalog.tools.map((tool) => [tool.name, tool]))
  return {
    kind: 'mcp',
    transport: config.url ? 'http' : 'stdio',
    endpoint: redact(config.url ?? [config.command, ...(config.args ?? [])].join(' ')),
    headers: Object.keys(config.headers ?? {}),
    allowUnannotated: Boolean(config.allowUnannotated),
    ...(catalog.server ? { server: catalog.server } : {}),
    tables: Object.entries(config.tables ?? {}).map(([table, spec]) => {
      const tool = byName.get(spec.tool)
      return {
        table,
        tool: spec.tool,
        args: redactValue(spec.args ?? {}),
        ...(spec.rows ? { rows: spec.rows } : {}),
        cache: spec.cache ?? '30s',
        params: placeholders(spec.args),
        ...(tool?.readOnly !== undefined ? { readOnly: tool.readOnly } : {}),
        ...(tool?.destructive ? { destructive: true } : {}),
        ...(tool?.title ? { title: tool.title } : {}),
      }
    }),
    tools: catalog.tools,
    ...(error ? { error } : {}),
  }
}
