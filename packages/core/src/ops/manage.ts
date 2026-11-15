import { cpSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ResolvedConfig } from '../workspace.js'
import { analyzeDashboard } from './analyze.js'
import { writeFileAtomic } from './atomic.js'
import { dashboardDir, dashboardFile, discoverDashboards, VALID_ID } from './dashboards.js'
import { OpsError } from './errors.js'
import { applyEdit, hashSource } from './layout.js'

/** `sales` → `sales-copy`, then `sales-copy-2`…; a copy of a copy counts on from the original. */
export function nextCopyId(id: string, taken: Set<string>): string {
  const stem = id.replace(/-copy(-\d+)?$/, '')
  let candidate = `${stem}-copy`
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-copy-${n}`
  return candidate
}

export function copyTitle(title: string): string {
  return /\(copy( \d+)?\)$/.test(title) ? title : `${title} (copy)`
}

/** Sets `meta.title`, refused if the file changed since `hash` was read (when given). */
export function renameDashboard(
  config: ResolvedConfig,
  id: string,
  title: string,
  hash?: string,
): { id: string; title: string; hash: string } {
  const file = dashboardFile(config, id)
  const code = readFileSync(file, 'utf8')
  if (hash !== undefined && hashSource(code) !== hash)
    throw new OpsError('the dashboard changed on disk since it was read — read it again', 409)
  const next = applyEdit(code, { kind: 'meta', key: 'title', value: title })
  if (next !== code) writeFileAtomic(file, next)
  return { id, title: title.trim(), hash: hashSource(next) }
}

/**
 * Copies a dashboard's folder — its layout, queries and notes — under a new id,
 * `<id>-copy` unless one is given, and marks the copy's title.
 */
export function duplicateDashboard(
  config: ResolvedConfig,
  id: string,
  newId?: string,
): { id: string; title: string } {
  const from = dashboardDir(config, id)
  const taken = new Set(discoverDashboards(config.root, config.dashboardsDir).map((d) => d.id))
  if (newId !== undefined) {
    if (!VALID_ID.test(newId)) throw new OpsError(`"${newId}" is not a dashboard id`)
    if (taken.has(newId) || existsSync(join(config.root, config.dashboardsDir, newId)))
      throw new OpsError(`dashboard "${newId}" already exists`, 409)
  }
  const target = newId ?? nextCopyId(id, taken)
  cpSync(from, join(config.root, config.dashboardsDir, target), {
    recursive: true,
    errorOnExist: true,
  })
  const file = dashboardFile(config, target)
  const { meta } = analyzeDashboard(readFileSync(file, 'utf8'), undefined, file)
  if (typeof meta.title !== 'string') return { id: target, title: target }
  const named = copyTitle(meta.title)
  renameDashboard(config, target, named)
  return { id: target, title: named }
}

/**
 * Moves a dashboard's folder to `.open-dashboard/trash/`, never deleting it,
 * so a mistaken delete is one move back.
 */
export function trashDashboard(
  config: ResolvedConfig,
  id: string,
): { id: string; trashedTo: string } {
  const from = dashboardDir(config, id)
  const trash = join(config.root, '.open-dashboard', 'trash')
  mkdirSync(trash, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const to = join(trash, `${id}-${stamp}`)
  renameSync(from, to)
  return { id, trashedTo: relative(config.root, to) }
}

/** An id from a title: `Sales by region` → `sales-by-region`; a title with no Latin letters gives `dashboard`. */
export function idFromTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return slug || 'dashboard'
}

const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/**
 * A new, empty dashboard — one Text panel saying what to do next — as
 * open-doc's blank document: `dashboards/<id>/index.tsx`, the id from the
 * title, numbered when taken.
 */
export function createDashboard(
  config: ResolvedConfig,
  rawTitle: string,
  now = new Date(),
): { id: string; title: string } {
  const title = rawTitle.trim()
  if (!title || title.length > 200 || /[\n\r]/.test(title))
    throw new OpsError('a title is one line of 1 to 200 characters')
  const base = idFromTitle(title)
  const dir = (id: string) => join(config.root, config.dashboardsDir, id)
  let id = base
  for (let n = 2; existsSync(dir(id)); n++) id = `${base}-${n}`
  mkdirSync(dir(id), { recursive: true })
  writeFileAtomic(
    join(dir(id), 'index.tsx'),
    `import { Dashboard, type DashboardMeta, Text } from '@open-dashboard/core'

export const meta: DashboardMeta = {
  title: ${quote(title)},
  createdAt: '${now.toISOString()}',
}

export default function Board() {
  return (
    <Dashboard>
      <Text title="Start here">
        <p>This dashboard is empty.</p>
        <p>
          Ask your agent: <code>/create-dashboard</code>, then describe what this dashboard should
          show. Panels go in <code>dashboards/${id}/index.tsx</code>, their SQL in{' '}
          <code>dashboards/${id}/queries.sql</code>.
        </p>
      </Text>
    </Dashboard>
  )
}
`,
  )
  return { id, title }
}
