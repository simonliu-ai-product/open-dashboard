import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ResolvedConfig } from '../workspace.js'
import { OpsError } from './errors.js'

export const DATABASES_DIR = 'databases'
export const DATABASE_DOC = 'database.md'

export interface DatabaseDoc {
  source: string
  /** Relative to the workspace root, whether or not it exists yet. */
  file: string
  /** null: not written yet. */
  markdown: string | null
}

/**
 * `databases/<source>/database.md`: what a database means, for the agent that
 * writes SQL against it and for whoever reads the schema page. Only configured
 * source names resolve, so the path never comes from the request.
 */
export function databaseDocPath(config: ResolvedConfig, source: string): string {
  if (!Object.hasOwn(config.datasources, source)) {
    throw new OpsError(`unknown datasource "${source}"`, 404)
  }
  return join(config.root, DATABASES_DIR, source, DATABASE_DOC)
}

export function readDatabaseDoc(config: ResolvedConfig, source: string): DatabaseDoc {
  const path = databaseDocPath(config, source)
  return {
    source,
    file: relative(config.root, path),
    markdown: existsSync(path) ? readFileSync(path, 'utf8') : null,
  }
}

/** The source a changed file documents, if it is a database.md. */
export function docSourceOf(config: ResolvedConfig, path: string): string | undefined {
  const parts = relative(join(config.root, DATABASES_DIR), path).split(/[\\/]/)
  if (parts.length !== 2 || parts[1] !== DATABASE_DOC) return undefined
  return parts[0]
}
