import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { type NamedQuery, parseQueryFile, QueryFileError } from './parse.js'

/** Every `*.sql` file in the dashboard's folder, merged into one namespace. */
export function loadQueries(dir: string, root: string): Map<string, NamedQuery> {
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

export type { NamedQuery } from './parse.js'
