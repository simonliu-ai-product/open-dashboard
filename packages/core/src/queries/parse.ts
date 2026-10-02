export interface NamedQuery {
  name: string
  sql: string
  source?: string
  description?: string
  /**
   * Other queries in this dashboard whose results this one reads as tables:
   * it runs in SQLite over those results instead of on a datasource.
   */
  uses?: string[]
  /** How long its result is reused: '5m', '30s', 'off'. Default: the config's `cache`. */
  cache?: string
  file: string
  /** 1-based line of the `-- name:` header. */
  line: number
}

export class QueryFileError extends Error {
  status = 500
}

const HEADER = /^\s*--\s*(name|source|description|uses|cache)\s*:\s*(.*?)\s*$/i
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

/**
 * A query file is plain SQL split by `-- name:` headers — the yesql/sqlc
 * convention, so the file still opens, highlights, and runs in any SQL tool.
 * The metadata lines must sit directly under the name; a `-- source:` further
 * down is just a comment in the query.
 */
export function parseQueryFile(text: string, file: string): NamedQuery[] {
  const lines = text.split(/\r?\n/)
  const queries: NamedQuery[] = []
  let current: NamedQuery | undefined
  let body: string[] = []
  let inHeader = false

  const finish = (): void => {
    if (!current) return
    const sql = body.join('\n').trim().replace(/;\s*$/, '').trim()
    if (!sql)
      throw new QueryFileError(`${file}:${current.line}: query "${current.name}" has no SQL`)
    if (current.uses && current.source) {
      throw new QueryFileError(
        `${file}:${current.line}: query "${current.name}" has both "-- source:" and "-- uses:" — a query that uses others runs over their results, not on a datasource`,
      )
    }
    queries.push({ ...current, sql })
  }

  lines.forEach((line, index) => {
    const header = HEADER.exec(line)
    const key = header?.[1]?.toLowerCase()
    if (header && key === 'name') {
      finish()
      const name = header[2] ?? ''
      if (!VALID_NAME.test(name)) {
        throw new QueryFileError(
          `${file}:${index + 1}: "${name}" is not a valid query name — use letters, digits, _ and -`,
        )
      }
      current = { name, sql: '', file, line: index + 1 }
      body = []
      inHeader = true
      return
    }
    if (
      header &&
      inHeader &&
      current &&
      (key === 'source' || key === 'description' || key === 'cache')
    ) {
      current[key] = header[2] ?? ''
      return
    }
    if (header && inHeader && current && key === 'uses') {
      current.uses = (header[2] ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
      return
    }
    inHeader = false
    if (current) {
      body.push(line)
      return
    }
    const stripped = line.trim()
    if (stripped && !stripped.startsWith('--')) {
      throw new QueryFileError(
        `${file}:${index + 1}: SQL before the first "-- name:" header — every query needs a name`,
      )
    }
  })
  finish()
  return queries
}
