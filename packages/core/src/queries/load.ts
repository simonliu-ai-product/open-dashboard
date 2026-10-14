import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { type NamedQuery, parseQueryFile, QueryFileError } from './parse.js'

function readDirQueries(dir: string, root: string): Map<string, NamedQuery> {
  const queries = new Map<string, NamedQuery>()
  if (!existsSync(dir)) return queries
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.sql')) continue
    const path = join(dir, entry)
    for (const query of parseQueryFile(readFileSync(path, 'utf8'), relative(root, path))) {
      const existing = queries.get(query.name)
      if (existing) {
        throw new QueryFileError(
          `query "${query.name}" is defined twice — ${existing.file}:${existing.line} and ${query.file}:${query.line}`,
        )
      }
      queries.set(query.name, query)
    }
  }
  return queries
}

/** Workspace-wide shared queries defined under `<root>/queries/*.sql`. */
export function loadSharedQueries(root: string): Map<string, NamedQuery> {
  return readDirQueries(join(root, 'queries'), root)
}

/**
 * Every `*.sql` file in the dashboard's folder, merged on top of workspace-wide
 * shared queries from `<root>/queries/*.sql` (unless `includeShared: false`).
 */
export function loadQueries(
  dir: string,
  root: string,
  options: { includeShared?: boolean } = {},
): Map<string, NamedQuery> {
  const merged =
    options.includeShared === false ? new Map<string, NamedQuery>() : loadSharedQueries(root)
  const local = readDirQueries(dir, root)
  for (const [name, query] of local) {
    merged.set(name, query)
  }
  return merged
}

export type { NamedQuery } from './parse.js'
