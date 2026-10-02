import { basename, dirname, join, relative, sep } from 'node:path'
import type { Connect, Plugin, ViteDevServer } from 'vite'
import type { ParamValue } from '../config.js'
import { errorMessage } from '../datasource/types.js'
import {
  addComment,
  dashboardQueries,
  docSourceOf,
  editLayout,
  getCurrent,
  type LayoutEdit,
  listComments,
  listDashboards,
  listSources,
  OpsError,
  readDatabaseDoc,
  readLayout,
  readSchema,
  runDashboardQuery,
  schemaToText,
  setCurrent,
} from '../ops/index.js'
import { type ConfigOverrides, loadConfig, type Workspace } from '../workspace.js'

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
  res.end(JSON.stringify(body))
}

async function readBody(req: Connect.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
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
        const documented = docSourceOf(workspace.config, path)
        if (documented) {
          server.ws.send({
            type: 'custom',
            event: 'odd:database-doc-changed',
            data: { source: documented },
          })
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
            server.config.logger.error(`  open-dashboard: ${name}: ${(error as Error).message}`)
          }
        }
      }
      server.watcher.add([join(root, '.env'), join(root, '.env.local')])
      server.watcher.on('change', onChange)
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)

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
