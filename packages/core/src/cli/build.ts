import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { build as viteBuild } from 'vite'
import { compileParams } from '../datasource/params.js'
import { dashboardQueries, discoverDashboards, listDashboards } from '../ops/dashboards.js'
import { OpsError } from '../ops/errors.js'
import { type DashboardSnapshot, snapshotDashboard } from '../ops/snapshot.js'
import { listThemes, readTheme } from '../ops/themes.js'
import { shell } from '../vite/app-plugin.js'
import { viteConfigFor } from '../vite/index.js'
import { manifestPlugin } from '../vite/manifest-plugin.js'
import { sourceEntry } from '../vite/package-root.js'
import { loadConfig, Workspace } from '../workspace.js'

export interface BuildOptions {
  root?: string
  /** Output folder, relative to the workspace. Default `site`. */
  out?: string
  /** Dashboards to include. Default: all. */
  ids?: string[]
  maxRuns?: number
  log?: (line: string) => void
}

export interface BuildResult {
  out: string
  dashboards: DashboardSnapshot[]
}

/**
 * The page resolves "last 30 days" against the moment the snapshot was taken,
 * on the reader's clock. Wall-clock time without a zone keeps that the same
 * calendar day wherever the page is opened, so the stored results still match.
 */
function wallClock(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  )
}

function inlineUsesSql(
  name: string,
  queries: ReturnType<typeof dashboardQueries>,
): { sql: string; source?: string } {
  const target = queries.get(name)
  if (!target) return { sql: '' }
  const order: string[] = []
  const visited = new Set<string>()
  const collect = (n: string) => {
    const q = queries.get(n)
    if (!q) return
    for (const u of q.uses ?? []) {
      if (!visited.has(u)) {
        visited.add(u)
        collect(u)
        order.push(u)
      }
    }
  }
  collect(name)
  let resolvedSource = target.source
  for (const u of order) {
    const uq = queries.get(u)
    if (!resolvedSource && uq?.source) resolvedSource = uq.source
  }
  const cleanSql = (raw: string) => raw.trim().replace(/;+\s*$/, '')
  if (order.length === 0) {
    return { sql: cleanSql(target.sql), source: resolvedSource }
  }
  const ctes = order.map((u) => {
    const uq = queries.get(u)
    return `${u} AS (\n${cleanSql(uq?.sql ?? '')}\n)`
  })
  const body = cleanSql(target.sql)
    .replace(/^(?:\s*--[^\n]*\n|\s*\/\*[\s\S]*?\*\/)+/, '')
    .trimStart()
  if (/^WITH\s+/i.test(body) && !/^WITH\s+RECURSIVE\b/i.test(body)) {
    return {
      sql: `WITH ${ctes.join(',\n')},\n${body.replace(/^WITH\s+/i, '')}`,
      source: resolvedSource,
    }
  }
  return {
    sql: `WITH ${ctes.join(',\n')}\n${body}`,
    source: resolvedSource,
  }
}

/** What the page reads, by path under `data/`: the dashboard list, every stored query, the themes it uses. */
export async function snapshotFiles(
  workspace: Workspace,
  ids: string[],
  options: {
    now: Date
    maxRuns?: number
    values?: Record<string, string | null>
    log?: (line: string) => void
  },
): Promise<{ files: Map<string, unknown>; snapshots: DashboardSnapshot[] }> {
  const config = workspace.config
  const files = new Map<string, unknown>()
  const snapshots: DashboardSnapshot[] = []
  for (const id of ids) {
    const snap = await snapshotDashboard(workspace, id, {
      now: options.now,
      ...(options.maxRuns ? { maxRuns: options.maxRuns } : {}),
      ...(options.values ? { values: options.values } : {}),
    })
    snapshots.push(snap)
    for (const [name, stored] of Object.entries(snap.queries))
      files.set(`d/${snap.id}/${encodeURIComponent(name)}.json`, stored)
    const rawQueries = dashboardQueries(config, id)
    const compiledQueries: Record<string, { sql: string; names: string[]; source: string }> = {}
    for (const qName of rawQueries.keys()) {
      const inlined = inlineUsesSql(qName, rawQueries)
      const compiled = compileParams(inlined.sql, 'question')
      const srcName = workspace.sourceName(inlined.source)
      compiledQueries[qName] = { sql: compiled.text, names: compiled.names, source: srcName }
    }
    files.set(`d/${snap.id}/_queries.json`, compiledQueries)
    const failed = Object.values(snap.queries).filter((q) =>
      Object.values(q.results).some((r) => 'error' in r),
    ).length
    options.log?.(
      `  ${id}: ${Object.keys(snap.queries).length} queries, ${snap.runs} runs` +
        (snap.trimmed.length ? `, defaults kept for ${snap.trimmed.join(', ')}` : '') +
        (failed ? `, ${failed} with errors` : ''),
    )
  }
  const summaries = listDashboards(config).filter((d) => ids.includes(d.id))
  files.set('dashboards.json', {
    dashboards: summaries.map((summary) => ({ ...summary, file: '' })),
  })
  const themes = listThemes(config)
  files.set('themes.json', themes)
  for (const theme of themes.themes) {
    const used =
      themes.default === theme.id || summaries.some((summary) => summary.theme === theme.id)
    if (used)
      files.set(`themes/${encodeURIComponent(theme.id)}.json`, {
        ...readTheme(config, theme.id),
        file: '',
      })
  }
  return { files, snapshots }
}

/**
 * The viewer, built by Vite with only these dashboards in its manifest. With
 * `single`, everything lands in one script — no chunks to fetch — for a file
 * that opens from disk.
 */
export async function bundleViewer(
  workspace: Workspace,
  ids: string[],
  outDir: string,
  single: boolean,
  base = './',
): Promise<{ file: string; css: string[] }> {
  const inline = viteConfigFor(workspace)
  inline.plugins = [
    ...(inline.plugins ?? [])
      .flat()
      .filter(
        (plugin) =>
          !(
            plugin &&
            typeof plugin === 'object' &&
            'name' in plugin &&
            plugin.name === 'open-dashboard:manifest'
          ),
      ),
    manifestPlugin(workspace, ids, !single),
  ]
  await viteBuild({
    ...inline,
    base,
    mode: 'production',
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        input: sourceEntry('app', 'main.tsx'),
        ...(single ? { output: { codeSplitting: false } } : {}),
      },
    },
  })
  const manifest = JSON.parse(
    readFileSync(join(outDir, '.vite', 'manifest.json'), 'utf8'),
  ) as Record<string, { file: string; isEntry?: boolean; css?: string[] }>
  rmSync(join(outDir, '.vite'), { recursive: true, force: true })
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
  if (!entry) throw new Error('the viewer bundle has no entry')
  return { file: entry.file, css: entry.css ?? [] }
}

function titled(html: string, title: string): string {
  // A function, not a string: `$&` and friends in a title must stay literal.
  return html.replace('<title>open-dashboard</title>', () => `<title>${escapeHtml(title)}</title>`)
}

/** Data inside a <script>: no `</script>` and no line separators can end it early. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * `open-dashboard build`: the viewer and the dashboards' results, as static
 * files any web server can host. The results are taken now — every filter
 * combination a query reads, up to `maxRuns` — and nothing on the page
 * reaches a database: no SQL, no connection, no file path is written out.
 */
export async function buildSite(options: BuildOptions = {}): Promise<BuildResult> {
  const log = options.log ?? (() => {})
  const config = await loadConfig(options.root ?? process.cwd())
  const out = resolve(config.root, options.out ?? 'site')
  // Emptied before writing: never the workspace itself or a folder holding it.
  if (out === config.root || config.root.startsWith(out + sep))
    throw new OpsError(`--out ${options.out} would overwrite the workspace`)

  const found = discoverDashboards(config.root, config.dashboardsDir)
  const unknown = (options.ids ?? []).filter((id) => !found.some((d) => d.id === id))
  if (unknown.length) throw new OpsError(`no dashboard named ${unknown.join(', ')}`, 404)
  const ids = options.ids?.length ? options.ids : found.map((d) => d.id)
  if (ids.length === 0) throw new OpsError(`no dashboards under ${config.dashboardsDir}/`, 404)

  const workspace = new Workspace(config)
  const now = new Date()
  let taken: Awaited<ReturnType<typeof snapshotFiles>>
  try {
    taken = await snapshotFiles(workspace, ids, {
      now,
      log,
      ...(options.maxRuns ? { maxRuns: options.maxRuns } : {}),
    })
  } finally {
    await workspace.close()
  }

  const rawEnvBase = process.env.COSTAFF_BASE?.trim()
  const envBase = rawEnvBase
    ? `${rawEnvBase.startsWith('/') ? '' : '/'}${rawEnvBase.replace(/\/+$/, '')}/`
    : undefined
  const entry = await bundleViewer(workspace, ids, out, false, envBase ?? './')
  // Runs before any module (they are deferred): when the snapshot was taken,
  // and where the site is served — wherever the entry script is
  // (`<base>/assets/…`), so the same files work at a domain root or under a path.
  const boot = `<script>(function(){var s=document.currentScript.previousElementSibling;window.__ODD_SNAPSHOT__={builtAt:${JSON.stringify(wallClock(now))},base:new URL('../',s.src).pathname}})()</script>\n`
  const page = (prefix: string, title: string) =>
    titled(
      shell(
        `${prefix}${entry.file}`,
        entry.css.map((css) => `<link rel="stylesheet" href="${prefix}${css}">\n`).join(''),
        boot,
      ),
      title,
    )

  writeFileSync(join(out, 'index.html'), page(envBase ?? './', 'open-dashboard'))
  for (const summary of listDashboards(config).filter((d) => ids.includes(d.id))) {
    // One page per dashboard, so a link to it works on any static host.
    const html = join(out, 'd', summary.id, 'index.html')
    mkdirSync(dirname(html), { recursive: true })
    writeFileSync(html, page(envBase ?? '../../', `${summary.title} · open-dashboard`))
  }
  for (const [path, value] of taken.files) writeJson(join(out, 'data', path), value)
  for (const [sourceName, ds] of Object.entries(config.datasources)) {
    if (ds.type === 'sqlite' && ds.file) {
      const dbSrc = resolve(config.root, ds.file)
      if (existsSync(dbSrc)) {
        const dbDest = join(out, 'data', '_sqlite', `${sourceName}.db`)
        mkdirSync(dirname(dbDest), { recursive: true })
        cpSync(dbSrc, dbDest)
      }
    }
  }
  if (!existsSync(join(out, 'index.html'))) throw new Error('nothing was written')
  const shown = relative(process.cwd(), out)
  log(`  wrote ${shown.startsWith('..') ? out : shown || '.'}/`)
  return { out, dashboards: taken.snapshots }
}

/**
 * One dashboard as one HTML file: the viewer, its styles and every stored
 * result inline, opening at the filters `search` sets. Nothing is fetched, so
 * it opens from disk or an attachment. Same contents rule as `build`: results
 * only — no SQL, no connection, no path.
 */
export async function exportHtml(
  workspace: Workspace,
  id: string,
  search = '',
  options: { maxRuns?: number; values?: Record<string, string | null> } = {},
): Promise<string> {
  const config = workspace.config
  const summary = listDashboards(config).find((d) => d.id === id)
  if (!summary) throw new OpsError(`no dashboard "${id}" under ${config.dashboardsDir}/`, 404)
  const now = new Date()
  const searchParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const searchValues: Record<string, string | null> = {}
  for (const [k, v] of searchParams.entries()) {
    searchValues[k] = v === '' ? null : v
  }
  const mergedValues = { ...searchValues, ...options.values }
  const { files } = await snapshotFiles(workspace, [id], {
    now,
    ...options,
    ...(Object.keys(mergedValues).length > 0 ? { values: mergedValues } : {}),
  })
  const dir = join(
    config.root,
    'node_modules',
    '.open-dashboard',
    `export-${process.pid}-${now.getTime()}`,
  )
  try {
    const entry = await bundleViewer(workspace, [id], dir, true)
    const script = readFileSync(join(dir, entry.file), 'utf8').replace(/<\/script/gi, '<\\/script')
    const styles = entry.css
      .map(
        (css) =>
          `<style>${readFileSync(join(dir, css), 'utf8').replace(/<\/style/gi, '<\\/style')}</style>\n`,
      )
      .join('')
    const snapshot = {
      builtAt: wallClock(now),
      base: '/',
      route: `/d/${id}`,
      search: search.startsWith('?') ? search : search ? `?${search}` : '',
      single: true,
    }
    const data = `<script>window.__ODD_SNAPSHOT__=${scriptJson(snapshot)};window.__ODD_DATA__=${scriptJson(Object.fromEntries(files))}</script>\n`
    return titled(
      shell('', styles + data).replace(
        '<script type="module" src=""></script>',
        // A function, not a string: the bundle is full of `$'` and `$&`.
        () => `<script type="module">${script}</script>`,
      ),
      summary.title,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
