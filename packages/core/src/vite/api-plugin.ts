import { basename, dirname, join, relative, sep } from 'node:path'
import type { Connect, Plugin, ViteDevServer } from 'vite'
import type { ParamValue } from '../config.js'
import { redact, redactValue } from '../datasource/redact.js'
import { errorMessage } from '../datasource/types.js'
import {
  type CollectorRun,
  listCollectors,
  runCollector,
  scheduleCollectors,
} from '../ops/collectors.js'
import { queryHistory } from '../ops/history.js'
import {
  type AnswerPiece,
  addComment,
  answerContext,
  assistantInstructions,
  assistantStatus,
  chartCatalog,
  dashboardQueries,
  describeSource,
  docSourceOf,
  editLayout,
  getCurrent,
  type LayoutEdit,
  listComments,
  listDashboards,
  listSources,
  listThemes,
  OpsError,
  readDatabaseDoc,
  readLayout,
  readSchema,
  readTheme,
  runChartQuery,
  runDashboardQuery,
  schemaToText,
  setCurrent,
  streamAnswer,
  systemPrompt,
  themeIdOf,
  validateMessages,
  writeTheme,
} from '../ops/index.js'
import { type ConfigOverrides, loadConfig, type Workspace } from '../workspace.js'
import { readBySource, referencedFiles, requestedFile } from './file-guard.js'

const PREFIX = '/__odd/api/'

interface Res {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

function json(res: Res, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Errors are masked where they are made; this is the last check before the
  // wire. Query results are not touched: they are the user's data.
  const safe = status >= 400 && body && typeof body === 'object' ? redactValue(body) : body
  res.end(JSON.stringify(safe))
}

/** Notes and layout edits are small; anything bigger is refused before it is held in memory. */
const MAX_BODY = 1024 * 1024

async function readBody(req: Connect.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new OpsError('request body over 1 MB', 413)
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

/**
 * These handlers write to the user's disk and read their database, so a page on
 * another origin must not be able to call them through the user's browser.
 */
function sameOrigin(req: Connect.IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

function parseParams(raw: string | null): Record<string, ParamValue> {
  if (!raw) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new OpsError('params must be an object')
  const out: Record<string, ParamValue> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      out[key] = value as ParamValue
    else throw new OpsError(`param "${key}" must be a string, number, boolean, or null`)
  }
  return out
}

/**
 * HTTP is a thin shell over `ops/` — the CLI calls the same functions, so a
 * query runs the same way from `open-dashboard check` as from a panel.
 */
export function apiPlugin(workspace: Workspace, overrides: ConfigOverrides): Plugin {
  return {
    name: 'open-dashboard:api',
    configureServer(server: ViteDevServer) {
      const { root } = workspace.config

      const onChange = async (path: string): Promise<void> => {
        const dashboards = join(root, workspace.config.dashboardsDir) + sep
        if (path.startsWith(dashboards) && path.endsWith('.sql')) {
          const id = relative(dashboards, dirname(path)).split(sep)[0]
          workspace.cache.clear(id)
          server.ws.send({ type: 'custom', event: 'odd:queries-changed', data: { id } })
          return
        }
        const charts = join(root, workspace.config.chartsDir) + sep
        if (path.startsWith(charts) && path.endsWith('.sql')) {
          const id = relative(charts, dirname(path)).split(sep)[0]
          workspace.cache.clear(`chart:${id}`)
          server.ws.send({ type: 'custom', event: 'odd:charts-changed', data: { id } })
          return
        }
        // A JSON or CSV file a datasource reads: every cached result may hold it.
        if (readBySource(workspace.config, path)) {
          workspace.cache.clear()
          server.ws.send({ type: 'custom', event: 'odd:queries-changed', data: {} })
          return
        }
        const documented = docSourceOf(workspace.config, path)
        if (documented) {
          server.ws.send({
            type: 'custom',
            event: 'odd:database-doc-changed',
            data: { source: documented },
          })
          return
        }
        const theme = themeIdOf(workspace.config, path)
        if (theme) {
          server.ws.send({ type: 'custom', event: 'odd:themes-changed', data: { id: theme } })
          return
        }
        const name = basename(path)
        if (
          dirname(path) === root &&
          (name.startsWith('open-dashboard.config.') || name.startsWith('.env'))
        ) {
          try {
            await workspace.reconfigure(await loadConfig(root, overrides))
            server.config.logger.info(`  open-dashboard: reloaded ${name}`)
            server.ws.send({ type: 'custom', event: 'odd:queries-changed', data: {} })
          } catch (error) {
            server.config.logger.error(`  open-dashboard: ${name}: ${errorMessage(error)}`)
          }
        }
      }
      // The data under every panel may have changed: refetch them all.
      const collected = (id: string, run: CollectorRun) => {
        server.ws.send({ type: 'custom', event: 'odd:collectors-changed', data: { id } })
        server.ws.send({ type: 'custom', event: 'odd:queries-changed', data: {} })
        server.config.logger.info(
          `  open-dashboard: collector ${id} ${run.ok ? 'done' : 'failed'} in ${Math.round(run.durationMs / 1000)} s`,
        )
      }
      const stopSchedule = scheduleCollectors(workspace, collected)
      server.httpServer?.once('close', stopSchedule)

      server.watcher.add([join(root, '.env'), join(root, '.env.local')])
      server.watcher.on('change', onChange)
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)

      // A file a datasource names — its database, a key — is never a page
      // asset, whatever it is called. Read per request, so a config reload counts.
      server.middlewares.use((req, res, next) => {
        const asked = requestedFile(req.url, workspace.config.root, PREFIX)
        if (
          asked &&
          (referencedFiles(workspace.config).has(asked) || readBySource(workspace.config, asked))
        ) {
          return json(res, 403, { error: 'this file is read through the query API only' })
        }
        next()
      })

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith(PREFIX)) return next()
        if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin request refused' })

        const url = new URL(req.url, 'http://localhost')
        const route = url.pathname.slice(PREFIX.length)
        const q = (key: string) => url.searchParams.get(key)
        const config = workspace.config

        try {
          if (route === 'dashboards' && req.method === 'GET') {
            return json(res, 200, { dashboards: listDashboards(config) })
          }
          if (route === 'query' && req.method === 'GET') {
            const id = q('id')
            const name = q('name')
            if (!id || !name) return json(res, 400, { error: 'id and name are required' })
            return json(
              res,
              200,
              await runDashboardQuery(workspace, id, name, parseParams(q('params')), {
                fresh: q('fresh') === '1',
              }),
            )
          }
          if (route === 'queries' && req.method === 'GET') {
            const id = q('id')
            if (!id) return json(res, 400, { error: 'id is required' })
            return json(res, 200, { queries: [...dashboardQueries(config, id).values()] })
          }
          if (route === 'layout' && req.method === 'GET') {
            const id = q('id')
            if (!id) return json(res, 400, { error: 'id is required' })
            return json(res, 200, readLayout(config, id))
          }
          if (route === 'layout' && req.method === 'POST') {
            const body = await readBody(req)
            if (
              typeof body.id !== 'string' ||
              typeof body.hash !== 'string' ||
              !Array.isArray(body.edits)
            ) {
              return json(res, 400, { error: 'id, hash and edits are required' })
            }
            return json(
              res,
              200,
              editLayout(config, body.id, body.edits as LayoutEdit[], body.hash),
            )
          }
          if (route === 'sources' && req.method === 'GET') {
            return json(res, 200, { sources: await listSources(workspace) })
          }
          if (route === 'source-detail' && req.method === 'GET') {
            const source = q('source')
            if (!source) return json(res, 400, { error: 'source is required' })
            return json(res, 200, await describeSource(workspace, source))
          }
          if (route === 'database-doc' && req.method === 'GET') {
            const source = q('source')
            if (!source) return json(res, 400, { error: 'source is required' })
            return json(res, 200, readDatabaseDoc(config, source))
          }
          if (route === 'schema' && req.method === 'GET') {
            const schema = await readSchema(workspace, q('source') ?? undefined)
            if (q('format') === 'text') {
              res.statusCode = 200
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              return res.end(schemaToText(schema))
            }
            return json(res, 200, schema)
          }
          if (route === 'current' && req.method === 'GET') {
            return json(res, 200, getCurrent(config) ?? {})
          }
          if (route === 'current' && req.method === 'POST') {
            return json(res, 200, setCurrent(config, await readBody(req), new Date().toISOString()))
          }
          if (route === 'assistant' && req.method === 'GET') {
            return json(res, 200, assistantStatus(workspace))
          }
          if (route === 'assistant' && req.method === 'POST') {
            const assistant = workspace.config.assistant
            if (!assistant) return json(res, 404, { error: 'the assistant is not configured' })
            const body = await readBody(req)
            if (typeof body.id !== 'string') return json(res, 400, { error: 'id is required' })
            const params = parseParams(body.params ? JSON.stringify(body.params) : null)
            const messages = validateMessages(body.messages)
            const controller = new AbortController()
            res.on('close', () => {
              if (!res.writableEnded) controller.abort()
            })
            const { context, read } = await answerContext(
              workspace,
              assistant,
              body.id,
              params,
              messages,
              controller.signal,
            )
            const system = systemPrompt(assistantInstructions(config, body.id), context)
            const stream = streamAnswer(assistant, system, messages, controller.signal)
            // The first piece is awaited before any header goes out, so a refused
            // key or an unknown model comes back as an ordinary JSON error.
            const first = await stream.next()
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            res.setHeader('X-Content-Type-Options', 'nosniff')
            // One JSON object per line: { read } — the panels it looked at — then
            // { thought } while the model thinks and { text } for the answer.
            const send = (line: Record<string, unknown>) => res.write(`${JSON.stringify(line)}\n`)
            if (read) send({ read })
            const write = (piece: AnswerPiece) =>
              send(piece.kind === 'thought' ? { thought: piece.text } : { text: piece.text })
            if (!first.done) write(first.value)
            try {
              for await (const piece of stream) write(piece)
            } catch (error) {
              if (!controller.signal.aborted) send({ error: redact(errorMessage(error)) })
            }
            return res.end()
          }
          if (route === 'collectors' && req.method === 'GET') {
            return json(res, 200, { collectors: listCollectors(workspace) })
          }
          if (route === 'collect' && req.method === 'POST') {
            // The page names a collector from the config; it never sends a command.
            const body = await readBody(req)
            if (typeof body.id !== 'string') return json(res, 400, { error: 'id is required' })
            const pending = runCollector(workspace, body.id)
            server.ws.send({
              type: 'custom',
              event: 'odd:collectors-changed',
              data: { id: body.id },
            })
            const run = await pending
            collected(body.id, run)
            return json(res, 200, run)
          }
          if (route === 'query-history' && req.method === 'GET') {
            const id = q('id')
            const name = q('name')
            if (!id || !name) return json(res, 400, { error: 'id and name are required' })
            return json(res, 200, await queryHistory(config, id, name))
          }
          if (route === 'export-html' && req.method === 'GET') {
            const id = q('id')
            if (!id) return json(res, 400, { error: 'id is required' })
            // Loaded on demand: it runs a Vite build, and imports what imports this file.
            const { exportHtml } = await import('../cli/build.js')
            const html = await exportHtml(workspace, id, q('search') ?? '')
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            return res.end(html)
          }
          if (route === 'charts' && req.method === 'GET') {
            return json(res, 200, { charts: await chartCatalog(workspace) })
          }
          if (route === 'chart-query' && req.method === 'GET') {
            const id = q('id')
            const name = q('name')
            if (!id || !name) return json(res, 400, { error: 'id and name are required' })
            return json(
              res,
              200,
              await runChartQuery(workspace, id, name, parseParams(q('params')), {
                fresh: q('fresh') === '1',
              }),
            )
          }
          if (route === 'themes' && req.method === 'GET') {
            return json(res, 200, listThemes(config))
          }
          if (route === 'theme' && req.method === 'GET') {
            const id = q('id')
            if (!id) return json(res, 400, { error: 'id is required' })
            return json(res, 200, readTheme(config, id))
          }
          if (route === 'theme' && req.method === 'POST') {
            const body = await readBody(req)
            if (typeof body.id !== 'string' || typeof body.hash !== 'string' || !body.theme) {
              return json(res, 400, { error: 'id, hash and theme are required' })
            }
            return json(res, 200, writeTheme(config, body.id, body.theme, body.hash))
          }
          if (route === 'comments' && req.method === 'GET') {
            const id = q('id')
            if (!id) return json(res, 400, { error: 'id is required' })
            return json(res, 200, { comments: listComments(config, id) })
          }
          if (route === 'comment' && req.method === 'POST') {
            const body = await readBody(req)
            if (
              typeof body.id !== 'string' ||
              typeof body.panel !== 'string' ||
              typeof body.text !== 'string'
            ) {
              return json(res, 400, { error: 'id, panel and text are required' })
            }
            return json(res, 200, addComment(config, body.id, body.panel, body.text))
          }
          return json(res, 404, { error: `unknown route ${route}` })
        } catch (error) {
          const status = (error as { status?: number }).status ?? 500
          return json(res, status, { error: errorMessage(error) })
        }
      })
    },
  }
}
