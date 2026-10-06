import { realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { matchesTable } from '../datasource/files.js'
import type { ResolvedConfig } from '../workspace.js'

/** Absolute paths of the files the configured datasources read. */
export function referencedFiles(config: ResolvedConfig): Set<string> {
  const out = new Set<string>()
  for (const source of Object.values(config.datasources)) {
    for (const key of ['file', 'keyFilename', 'privateKeyPath'] as const) {
      const value = (source as Partial<Record<typeof key, unknown>>)[key]
      if (typeof value === 'string' && value && value !== ':memory:') {
        out.add(realFile(resolve(config.root, value)))
      }
    }
  }
  return out
}

/**
 * Whether a JSON or CSV datasource reads this file — a table's file, or one
 * its glob matches. Checked by pattern, so a file added later is covered too.
 */
export function readBySource(config: ResolvedConfig, path: string): boolean {
  const file = relative(config.root, path).split(sep).join('/')
  if (file.startsWith('..')) return false
  return Object.values(config.datasources).some(
    (source) =>
      (source.type === 'json' || source.type === 'csv') &&
      Object.values(source.tables ?? {}).some((table) => matchesTable(table.file, file)),
  )
}

/** The file a dev-server URL would read: `/@fs/abs/path` or a path under the root. */
export function requestedFile(
  url: string | undefined,
  root: string,
  apiPrefix: string,
): string | undefined {
  if (!url || url.startsWith(apiPrefix)) return undefined
  let path: string
  try {
    path = decodeURIComponent(new URL(url, 'http://localhost').pathname)
  } catch {
    return undefined
  }
  return realFile(path.startsWith('/@fs/') ? path.slice(4) : join(root, path))
}

function realFile(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
