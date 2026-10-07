import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { build as viteBuild } from 'vite'
import { discoverDashboards, listDashboards } from '../ops/dashboards.js'
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

/** What the page reads, by path under `data/`: the dashboard list, every stored query, the themes it uses. */
export async function snapshotFiles(
  workspace: Workspace,
  ids: string[],
  options: { now: Date; maxRuns?: number; log?: (line: string) => void },
): Promise<{ files: Map<string, unknown>; snapshots: DashboardSnapshot[] }> {
  const config = workspace.config
  const files = new Map<string, unknown>()
  const snapshots: DashboardSnapshot[] = []
  for (const id of ids) {
    const snap = await snapshotDashboard(workspace, id, {
      now: options.now,
      ...(options.maxRuns ? { maxRuns: options.maxRuns } : {}),
    })
    snapshots.push(snap)
    for (const [name, stored] of Object.entries(snap.queries))
      files.set(`d/${snap.id}/${encodeURIComponent(name)}.json`, stored)
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
async function bundleViewer(
  workspace: Workspace,
  ids: string[],
  outDir: string,
  single: boolean,
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
    base: './',
    mode: 'production',
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      manifest: true,
      chunkSizeWarningLimit: 4000,
      rollupOptions: {
        input: sourceEntry('app', 'main.tsx'),
        ...(single ? { output: { inlineDynamicImports: true } } : {}),
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

  const entry = await bundleViewer(workspace, ids, out, false)
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

  writeFileSync(join(out, 'index.html'), page('./', 'open-dashboard'))
  for (const summary of listDashboards(config).filter((d) => ids.includes(d.id))) {
    // One page per dashboard, so a link to it works on any static host.
    const html = join(out, 'd', summary.id, 'index.html')
    mkdirSync(dirname(html), { recursive: true })
    writeFileSync(html, page('../../', `${summary.title} · open-dashboard`))
  }
  for (const [path, value] of taken.files) writeJson(join(out, 'data', path), value)
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
  options: { maxRuns?: number } = {},
): Promise<string> {
  const config = workspace.config
  const summary = listDashboards(config).find((d) => d.id === id)
  if (!summary) throw new OpsError(`no dashboard "${id}" under ${config.dashboardsDir}/`, 404)
  const now = new Date()
  const { files } = await snapshotFiles(workspace, [id], { now, ...options })
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
