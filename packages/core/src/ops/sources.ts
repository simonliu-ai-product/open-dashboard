import type { SchemaInfo } from '../config.js'
import { errorMessage } from '../datasource/types.js'
import type { Workspace } from '../workspace.js'

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
