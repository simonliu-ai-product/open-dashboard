import type { McpServer } from '@modelcontextprotocol/server'
import {
  addComment,
  chartCatalog,
  checkWorkspace,
  errorMessage,
  getCurrent,
  listComments,
  listDashboards,
  listSources,
  listThemes,
  OpsError,
  readDashboardFiles,
  readDatabaseDoc,
  readSchema,
  readTheme,
  runDashboardQuery,
  runSql,
  schemaToText,
  type Workspace,
  writeDashboardFile,
  writeDatabaseDoc,
  writeTheme,
} from '@open-dashboard/core/node'
import { z } from 'zod'

/**
 * Every tool is a thin wrapper over core's `ops/` — the functions the dev
 * server calls for the browser and the CLI calls for the terminal. An agent
 * and a person in the viewer go through one implementation, its read-only
 * drivers and its conflict checks included.
 */

const PARAM = z.union([z.string(), z.number(), z.boolean(), z.null()])
const PARAMS = z
  .record(z.string(), PARAM)
  .optional()
  .describe('values for the :name parameters the query reads; null means "all"')
const LIMIT = z
  .number()
  .int()
  .positive()
  .max(500)
  .optional()
  .describe('rows to return (default 50, at most 500)')

function ok(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { content: [{ type: 'text' as const, text }] }
}

/**
 * A refusal or a failed query is something the agent can act on — a wrong id,
 * a stale write, an SQL error — so it comes back as a tool error, with any
 * secret in it masked, not as a transport failure.
 */
async function run(fn: () => unknown) {
  try {
    return ok(await fn())
  } catch (error) {
    const status = error instanceof OpsError ? `${error.status}: ` : ''
    return {
      isError: true,
      content: [{ type: 'text' as const, text: status + errorMessage(error) }],
    }
  }
}

function rows<T extends { rows: unknown[] }>(result: T, limit = 50) {
  return { ...result, rows: result.rows.slice(0, limit), rowCount: result.rows.length }
}

export interface ToolOptions {
  /** Register run_sql: read-only SQL of the agent's own against any datasource. */
  allowSql: boolean
}

export function registerTools(server: McpServer, workspace: Workspace, options: ToolOptions): void {
  const config = () => workspace.config

  server.registerTool(
    'list_dashboards',
    {
      title: 'List dashboards',
      description:
        'Every dashboard in the workspace: id, title, panels and the queries they use. Start here.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => run(() => listDashboards(config())),
  )

  server.registerTool(
    'read_dashboard',
    {
      title: 'Read a dashboard',
      description:
        "A dashboard's files: index.tsx (the layout, React) and every .sql file (its named queries), each with a hash. Read before writing.",
      inputSchema: z.object({ id: z.string().describe('the dashboard folder under dashboards/') }),
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(() => readDashboardFiles(config(), id)),
  )

  server.registerTool(
    'write_dashboard_file',
    {
      title: 'Write a dashboard file',
      description:
        'Write index.tsx or a <name>.sql file of a dashboard; a new id creates the dashboard. Pass `expected` (the hash from read_dashboard) to change an existing file: if it changed meanwhile the write is refused (409) — read again and reapply. The viewer reloads on its own. Run check_dashboard afterwards.',
      inputSchema: z.object({
        id: z.string().describe('kebab-case folder name under dashboards/'),
        file: z.string().describe('index.tsx, or <name>.sql'),
        content: z.string().describe('the complete file'),
        expected: z.string().optional().describe('hash of the file as read; omit for a new file'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ id, file, content, expected }) =>
      run(() => writeDashboardFile(config(), id, file, content, expected)),
  )

  server.registerTool(
    'check_dashboard',
    {
      title: 'Check dashboards',
      description:
        'Run every query of a dashboard (or all of them) with the filters’ defaults and verify each panel: query names, columns, parameters. Fix every error before calling a dashboard done.',
      inputSchema: z.object({ id: z.string().optional().describe('one dashboard; omit for all') }),
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(() => checkWorkspace(workspace, id)),
  )

  server.registerTool(
    'run_query',
    {
      title: 'Run a named query',
      description:
        "Run one of a dashboard's named queries, as a panel would, and return its rows and column types.",
      inputSchema: z.object({
        dashboard: z.string(),
        query: z.string().describe('the -- name: of the query'),
        params: PARAMS,
        limit: LIMIT,
        fresh: z.boolean().optional().describe('skip the result cache'),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ dashboard, query, params, limit, fresh }) =>
      run(async () => {
        const result = await runDashboardQuery(workspace, dashboard, query, params ?? {}, {
          fresh: fresh ?? false,
        })
        return {
          source: result.query.source,
          cached: result.cached ?? false,
          ...rows(result.result, limit),
        }
      }),
  )

  server.registerTool(
    'list_sources',
    {
      title: 'List datasources',
      description:
        'Every configured datasource, its type, whether it connects, and how many tables it has.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => run(() => listSources(workspace)),
  )

  server.registerTool(
    'read_schema',
    {
      title: 'Read a schema',
      description:
        'Tables, columns, types, keys and row counts of a datasource. Read its notes (read_database_doc) too before writing SQL.',
      inputSchema: z.object({
        source: z.string().optional().describe('default: the default source'),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ source }) => run(async () => schemaToText(await readSchema(workspace, source))),
  )

  server.registerTool(
    'read_database_doc',
    {
      title: 'Read database notes',
      description:
        'databases/<source>/database.md: what the tables and columns mean, values to filter on, units, traps. markdown is null when there are none yet.',
      inputSchema: z.object({ source: z.string() }),
      annotations: { readOnlyHint: true },
    },
    ({ source }) => run(() => readDatabaseDoc(config(), source)),
  )

  server.registerTool(
    'write_database_doc',
    {
      title: 'Write database notes',
      description:
        'Write databases/<source>/database.md. Pass `expected` (the hash from read_database_doc) when notes exist; a change made meanwhile is refused (409).',
      inputSchema: z.object({
        source: z.string(),
        markdown: z.string(),
        expected: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ source, markdown, expected }) =>
      run(() => writeDatabaseDoc(config(), source, markdown, expected)),
  )

  server.registerTool(
    'list_charts',
    {
      title: 'List charts',
      description:
        'Every chart a dashboard can use — the built-in panels and the custom ones under charts/ — with the props that name columns and the dashboards using each. Check it before writing a new chart.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () =>
        (await chartCatalog(workspace)).map(({ example: _example, ...entry }) => entry),
      ),
  )

  server.registerTool(
    'list_themes',
    {
      title: 'List themes',
      description: 'The themes under themes/ and the workspace default.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => run(() => listThemes(config())),
  )

  server.registerTool(
    'read_theme',
    {
      title: 'Read a theme',
      description: 'A theme file and its hash.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(() => readTheme(config(), id)),
  )

  server.registerTool(
    'write_theme',
    {
      title: 'Write a theme',
      description:
        'Write themes/<id>.json. It is validated field by field (hex colours, a font-family list, radius 0–24); anything else is refused. Pass `expected` (the hash from read_theme) to change an existing theme.',
      inputSchema: z.object({
        id: z.string(),
        theme: z.record(z.string(), z.unknown()).describe('the theme document'),
        expected: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ id, theme, expected }) => run(() => writeTheme(config(), id, theme, expected ?? '')),
  )

  server.registerTool(
    'list_comments',
    {
      title: 'List notes',
      description:
        'The notes the person left on panels in the viewer (@dashboard-comment), waiting to be applied.',
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    ({ id }) => run(() => listComments(config(), id)),
  )

  server.registerTool(
    'add_comment',
    {
      title: 'Leave a note on a panel',
      description: 'Anchor a @dashboard-comment above the panel with this title, for a later pass.',
      inputSchema: z.object({
        id: z.string(),
        panel: z.string().describe('the panel title'),
        text: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    ({ id, panel, text }) => run(() => addComment(config(), id, panel, text)),
  )

  server.registerTool(
    'current_view',
    {
      title: 'What the person is looking at',
      description:
        'The dashboard open in the viewer, the panel last inspected and the filters set — what "this chart" or "this dashboard" means.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => run(() => getCurrent(config()) ?? { id: null }),
  )

  if (options.allowSql) {
    server.registerTool(
      'run_sql',
      {
        title: 'Run SQL',
        description:
          'Run one read-only SQL statement against a datasource, in its dialect, to explore data before writing a query. Every driver refuses writes. Dashboards still keep their SQL in .sql files.',
        inputSchema: z.object({
          sql: z.string(),
          source: z.string().optional().describe('default: the default source'),
          params: PARAMS,
          limit: LIMIT,
        }),
        annotations: { readOnlyHint: true },
      },
      ({ sql, source, params, limit }) =>
        run(async () => rows(await runSql(workspace, sql, source, params ?? {}), limit)),
    )
  }
}
