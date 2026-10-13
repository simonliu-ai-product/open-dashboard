import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { redact } from '../datasource/redact.js'
import { errorMessage } from '../datasource/types.js'
import { scheduleCollectors } from '../ops/collectors.js'
import {
  assistantStatus,
  discoverDashboards,
  listDashboards,
  listThemes,
  OpsError,
  readTheme,
  runDashboardQuery,
} from '../ops/index.js'
import { shell } from '../vite/app-plugin.js'
import { askAssistant, json, parseParams, sameOrigin } from '../vite/http.js'
import { packageRoot } from '../vite/package-root.js'
import { type ConfigOverrides, loadConfig, Workspace } from '../workspace.js'
import { bundleViewer } from './build.js'

export interface ServeOptions {
  root?: string
  /** Default: `PORT`, else the config's port. */
  port?: number
  /** Default 127.0.0.1; `0.0.0.0` in a container. */
  host?: string
  /** Build the viewer and stop — for a Docker image, so the container starts at once. */
  buildOnly?: boolean
  log?: (line: string) => void
}

export interface Viewer {
  dir: string
  file: string
  css: string[]
}

const PREFIX = '/__odd/api/'
const LOCAL = new Set(['localhost', '127.0.0.1', '::1'])
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.map': 'application/json',
}

/** Every file the viewer bundle is built from, by path, size and mtime — and the core version. */
function fingerprint(workspace: Workspace): string {
  const { root, dashboardsDir, chartsDir } = workspace.config
  const hash = createHash('sha256')
  hash.update(readFileSync(join(packageRoot(), 'package.json')))
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      // SQL is read per request from disk, not bundled.
      else if (!entry.name.endsWith('.sql')) {
        const stat = statSync(path)
        hash.update(`${relative(root, path)}:${stat.size}:${stat.mtimeMs}\n`)
      }
    }
  }
  walk(join(root, dashboardsDir))
  walk(join(root, chartsDir))
  return hash.digest('hex').slice(0, 16)
}

/**
 * The viewer, built once per change to the dashboards, charts or core:
 * `node_modules/.open-dashboard/serve/<fingerprint>/`. A container that ran
 * `serve --build-only` in its image starts without building.
 */
export async function prepareViewer(
  workspace: Workspace,
  log: (line: string) => void = () => {},
): Promise<Viewer> {
  const base = join(workspace.config.root, 'node_modules', '.open-dashboard', 'serve')
  const dir = join(base, fingerprint(workspace))
  const saved = join(dir, 'entry.json')
  if (existsSync(saved)) {
    log('  viewer: up to date')
    return { dir, ...(JSON.parse(readFileSync(saved, 'utf8')) as Omit<Viewer, 'dir'>) }
  }
  log('  viewer: building…')
  const ids = discoverDashboards(workspace.config.root, workspace.config.dashboardsDir).map(
    (d) => d.id,
  )
  const entry = await bundleViewer(workspace, ids, dir, false)
  writeFileSync(saved, JSON.stringify(entry))
  for (const old of existsSync(base) ? readdirSync(base) : []) {
    if (join(base, old) !== dir) rmSync(join(base, old), { recursive: true, force: true })
  }
  log('  viewer: built')
  return { dir, ...entry }
}

/** The Host a request names, without its port, against localhost and `serve.allowedHosts`. */
export function hostAllowed(header: string | undefined, allowed: string[]): boolean {
  const host = (header ?? '')
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/^\[(.*)\]$/, '$1')
  if (!host) return false
  if (LOCAL.has(host)) return true
  return allowed.some((entry) =>
    entry.startsWith('.') ? host.endsWith(entry) || host === entry.slice(1) : host === entry,
  )
}

function text(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(body)
}

/**
 * The reader's server: the built viewer, and of the API only what reading
 * needs — the dashboard list, named queries, themes, the assistant when
 * `serve.assistant` is on. Nothing writes, nothing returns SQL or a path, and
 * `fresh` is ignored, so a reader cannot make every panel skip the cache.
 */
export function serveHandler(
  workspace: Workspace,
  viewer: Viewer,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const page = shell(
    `/${viewer.file}`,
    viewer.css.map((css) => `<link rel="stylesheet" href="/${css}">\n`).join(''),
    '<script>window.__ODD_SERVED__=true</script>\n',
  )
  const assets = resolve(viewer.dir, 'assets')

  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    const config = workspace.config
    if (!hostAllowed(req.headers.host, config.serve.allowedHosts)) {
      return text(res, 403, 'this host is not allowed — add it to serve.allowedHosts')
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    if (path.startsWith(PREFIX)) {
      if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin request refused' })
      const route = path.slice(PREFIX.length)
      const q = (key: string) => url.searchParams.get(key)
      try {
        if (route === 'assistant' && req.method === 'POST') {
          if (!config.serve.assistant) return json(res, 404, { error: 'the assistant is off' })
          return await askAssistant(workspace, req, res)
        }
        if (req.method !== 'GET') return json(res, 405, { error: 'read-only server' })
        if (route === 'dashboards') {
          return json(res, 200, {
            dashboards: listDashboards(config).map((d) => ({ ...d, file: '' })),
          })
        }
        if (route === 'query') {
          const id = q('id')
          const name = q('name')
          if (!id || !name) return json(res, 400, { error: 'id and name are required' })
          const run = await runDashboardQuery(workspace, id, name, parseParams(q('params')))
          // The SQL and where it lives stay with the workspace; the page needs the rows.
          return json(res, 200, {
            ...run,
            query: { name, source: run.query.source, sql: '', file: '', line: 0 },
          })
        }
        if (route === 'themes') return json(res, 200, listThemes(config))
        if (route === 'theme') {
          const id = q('id')
          if (!id) return json(res, 400, { error: 'id is required' })
          return json(res, 200, { ...readTheme(config, id), file: '' })
        }
        if (route === 'assistant') {
          return json(res, 200, {
            enabled: config.serve.assistant && assistantStatus(workspace).enabled,
          })
        }
        return json(res, 404, { error: `unknown route ${route}` })
      } catch (error) {
        const status = error instanceof OpsError ? error.status : 500
        return json(res, status, { error: errorMessage(error) })
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'read-only server')
    if (path.startsWith('/assets/')) {
      const file = resolve(viewer.dir, `.${decodeURIComponent(path)}`)
      if (!file.startsWith(assets + sep) || !existsSync(file) || !statSync(file).isFile()) {
        return text(res, 404, 'not found')
      }
      res.statusCode = 200
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
      // Hashed file names: a new build has new names.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      return void res.end(req.method === 'HEAD' ? undefined : readFileSync(file))
    }
    if (extname(path)) return text(res, 404, 'not found')
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(req.method === 'HEAD' ? undefined : page)
  }
}

/**
 * `open-dashboard serve`: the dashboards for readers, with live results. No
 * Vite at runtime, no file watching, nothing that edits — put it behind your
 * own sign-in (IAP, Cloudflare Access, a proxy); it has none of its own.
 */
export async function serve(
  options: ServeOptions = {},
): Promise<{ url: string; server?: Server; close: () => Promise<void> }> {
  const log = options.log ?? ((line: string) => process.stdout.write(`${redact(line)}\n`))
  const overrides: ConfigOverrides = {}
  const port = options.port ?? (Number(process.env.PORT) || undefined)
  if (port) overrides.port = port
  const config = await loadConfig(options.root ?? process.cwd(), overrides)
  const workspace = new Workspace(config)
  const viewer = await prepareViewer(workspace, log)
  if (options.buildOnly) {
    await workspace.close()
    return { url: '', close: async () => {} }
  }

  const handler = serveHandler(workspace, viewer)
  const server = createServer((req, res) => {
    handler(req, res).catch((error) => {
      if (!res.headersSent) json(res, 500, { error: errorMessage(error) })
      else res.end()
    })
  })
  const host = options.host ?? '127.0.0.1'
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(config.port, host, done)
  })
  const stopSchedule = scheduleCollectors(workspace, (id, run) => {
    const last = run.ok ? '' : run.output.split('\n').at(-1)
    log(
      `  collector ${id} ${run.ok ? 'done' : 'failed'} in ${Math.round(run.durationMs / 1000)} s${last ? ` — ${last}` : ''}`,
    )
  })
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host
  const url = `http://${shown}:${config.port}/`
  log(`\n  open-dashboard serve  ${url}  (read-only)`)
  if (host !== '127.0.0.1' && host !== 'localhost' && config.serve.allowedHosts.length === 0) {
    log('  only localhost is answered — list your domain in serve.allowedHosts')
  }

  const close = async () => {
    stopSchedule()
    await new Promise<void>((done) => server.close(() => done()))
    await workspace.close()
  }
  return { url, server, close }
}
