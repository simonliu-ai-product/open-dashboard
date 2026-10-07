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
  const snapshots: DashboardSnapshot[] = []
  try {
    for (const id of ids) {
      const snap = await snapshotDashboard(workspace, id, {
        now,
        ...(options.maxRuns ? { maxRuns: options.maxRuns } : {}),
      })
      snapshots.push(snap)
      const failed = Object.values(snap.queries).filter((q) =>
        Object.values(q.results).some((r) => 'error' in r),
      ).length
      log(
        `  ${id}: ${Object.keys(snap.queries).length} queries, ${snap.runs} runs` +
          (snap.trimmed.length ? `, defaults kept for ${snap.trimmed.join(', ')}` : '') +
          (failed ? `, ${failed} with errors` : ''),
      )
    }
  } finally {
    await workspace.close()
  }

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
    manifestPlugin(workspace, ids),
  ]
  await viteBuild({
    ...inline,
    base: './',
    mode: 'production',
    logLevel: 'error',
    build: {
      outDir: out,
      emptyOutDir: true,
      manifest: true,
      chunkSizeWarningLimit: 4000,
      rollupOptions: { input: sourceEntry('app', 'main.tsx') },
    },
  })

  const manifestFile = join(out, '.vite', 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<
    string,
    { file: string; isEntry?: boolean; css?: string[] }
  >
  rmSync(join(out, '.vite'), { recursive: true, force: true })
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
  if (!entry) throw new Error('the viewer bundle has no entry')

  // Runs before any module (they are deferred): when the snapshot was taken, and where the site is
  // served — wherever the entry script is (`<base>/assets/…`), so the same
  // files work at a domain root or under a path.
  const boot = `<script>(function(){var s=document.currentScript.previousElementSibling;window.__ODD_SNAPSHOT__={builtAt:${JSON.stringify(wallClock(now))},base:new URL('../',s.src).pathname}})()</script>\n`
  const page = (prefix: string, title: string) =>
    shell(
      `${prefix}${entry.file}`,
      (entry.css ?? []).map((css) => `<link rel="stylesheet" href="${prefix}${css}">\n`).join(''),
      boot,
    ).replace('<title>open-dashboard</title>', `<title>${escapeHtml(title)}</title>`)

  const summaries = listDashboards(config).filter((d) => ids.includes(d.id))
  writeFileSync(join(out, 'index.html'), page('./', 'open-dashboard'))
  for (const summary of summaries) {
    // One page per dashboard, so a link to it works on any static host.
    const html = join(out, 'd', summary.id, 'index.html')
    mkdirSync(dirname(html), { recursive: true })
    writeFileSync(html, page('../../', `${summary.title} · open-dashboard`))
  }

  const data = join(out, 'data')
  writeJson(join(data, 'dashboards.json'), {
    dashboards: summaries.map(({ file: _file, ...summary }) => ({ ...summary, file: '' })),
  })
  for (const snap of snapshots) {
    for (const [name, stored] of Object.entries(snap.queries)) {
      writeJson(join(data, 'd', snap.id, `${encodeURIComponent(name)}.json`), stored)
    }
  }
  const themes = listThemes(config)
  writeJson(join(data, 'themes.json'), themes)
  for (const theme of themes.themes) {
    const used =
      themes.default === theme.id || summaries.some((summary) => summary.theme === theme.id)
    if (!used) continue
    const file = readTheme(config, theme.id)
    writeJson(join(data, 'themes', `${encodeURIComponent(theme.id)}.json`), {
      ...file,
      file: '',
    })
  }
  if (!existsSync(join(out, 'index.html'))) throw new Error('nothing was written')
  const shown = relative(process.cwd(), out)
  log(`  wrote ${shown.startsWith('..') ? out : shown || '.'}/`)
  return { out, dashboards: snapshots }
}
