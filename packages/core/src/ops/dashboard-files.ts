import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ResolvedConfig } from '../workspace.js'
import { VALID_ID } from './dashboards.js'
import { OpsError } from './errors.js'
import { hashSource } from './layout.js'

/** A dashboard is its layout and its queries; nothing else is written through here. */
const FILE_NAME = /^(index\.tsx|[A-Za-z0-9][A-Za-z0-9_-]*\.sql)$/

export interface DashboardFile {
  name: string
  content: string
  /** Pass back as `expected` to write it: a changed file is refused, not overwritten. */
  hash: string
}

export interface DashboardFiles {
  id: string
  /** Relative to the workspace root. */
  dir: string
  files: DashboardFile[]
}

function folder(config: ResolvedConfig, id: string): string {
  if (!VALID_ID.test(id)) throw new OpsError(`"${id}" is not a dashboard id`)
  return join(config.root, config.dashboardsDir, id)
}

/** A dashboard's index.tsx and every .sql file beside it, with a hash of each. */
export function readDashboardFiles(config: ResolvedConfig, id: string): DashboardFiles {
  const dir = folder(config, id)
  if (!existsSync(dir))
    throw new OpsError(`no dashboard "${id}" under ${config.dashboardsDir}/`, 404)
  const files = readdirSync(dir)
    .filter((name) => FILE_NAME.test(name))
    .sort((a, b) => (a === 'index.tsx' ? -1 : b === 'index.tsx' ? 1 : a.localeCompare(b)))
    .map((name) => {
      const content = readFileSync(join(dir, name), 'utf8')
      return { name, content, hash: hashSource(content) }
    })
  return { id, dir: relative(config.root, dir), files }
}

/**
 * Writes one file of a dashboard — its index.tsx or a .sql file — creating the
 * dashboard's folder when it is new. `expected` is the hash the caller read:
 * '' (or omitted) for a file that must not exist yet, so a concurrent edit by
 * the person in the browser or another agent is refused (409), never lost.
 */
export function writeDashboardFile(
  config: ResolvedConfig,
  id: string,
  name: string,
  content: string,
  expected = '',
): { file: string; hash: string; created: boolean } {
  if (!FILE_NAME.test(name)) {
    throw new OpsError(`"${name}" is not a dashboard file — write index.tsx or <name>.sql`)
  }
  const dir = folder(config, id)
  const path = join(dir, name)
  const exists = existsSync(path)
  const current = exists ? hashSource(readFileSync(path, 'utf8')) : ''
  if (current !== expected) {
    throw new OpsError(
      exists
        ? expected
          ? `${name} changed since it was read — read the dashboard again and reapply the change`
          : `${name} already exists — read the dashboard and pass its hash as expected`
        : `${name} does not exist — pass no expected hash to create it`,
      409,
    )
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, content)
  return { file: relative(config.root, path), hash: hashSource(content), created: !exists }
}
