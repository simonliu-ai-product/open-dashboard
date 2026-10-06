import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { ResolvedConfig } from '../workspace.js'
import { OpsError } from './errors.js'
import { hashSource } from './layout.js'

export const DATABASES_DIR = 'databases'
export const DATABASE_DOC = 'database.md'

export interface DatabaseDoc {
  source: string
  /** Relative to the workspace root, whether or not it exists yet. */
  file: string
  /** null: not written yet. */
  markdown: string | null
  /** Pass back as `expected` to writeDatabaseDoc; '' when there are no notes yet. */
  hash: string
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
    hash: existsSync(path) ? hashSource(readFileSync(path, 'utf8')) : '',
  }
}

/** The source a changed file documents, if it is a database.md. */
export function docSourceOf(config: ResolvedConfig, path: string): string | undefined {
  const parts = relative(join(config.root, DATABASES_DIR), path).split(/[\\/]/)
  if (parts.length !== 2 || parts[1] !== DATABASE_DOC) return undefined
  return parts[0]
}

/**
 * Writes `databases/<source>/database.md`. `expected` is the hash of the notes
 * the caller read ('' when there were none), so an edit made meanwhile is
 * refused rather than overwritten.
 */
export function writeDatabaseDoc(
  config: ResolvedConfig,
  source: string,
  markdown: string,
  expected = '',
): { file: string; hash: string } {
  const path = databaseDocPath(config, source)
  const current = existsSync(path) ? hashSource(readFileSync(path, 'utf8')) : ''
  if (current !== expected) {
    throw new OpsError(
      current
        ? `${DATABASE_DOC} for "${source}" changed since it was read — read it again and reapply the change`
        : `there is no ${DATABASE_DOC} for "${source}" yet — pass no expected hash to create it`,
      409,
    )
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, markdown)
  return { file: relative(config.root, path), hash: hashSource(markdown) }
}
