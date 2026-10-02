import { DatasourceError } from './types.js'

const WRITE_KEYWORDS = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'into',
  'upsert',
  'replace',
  'create',
  'alter',
  'drop',
  'truncate',
  'rename',
  'grant',
  'revoke',
  'call',
  'exec',
  'execute',
  'copy',
  'put',
  'remove',
  'unload',
  'attach',
  'detach',
  'install',
  'load',
  'vacuum',
  'optimize',
  'kill',
  'use',
  'set',
  'commit',
  'rollback',
  'begin',
])

const READ_STARTS = new Set([
  'select',
  'with',
  'values',
  'show',
  'describe',
  'desc',
  'explain',
  'table',
])

/**
 * Words outside string literals, quoted identifiers and comments, lowercased.
 * A word directly followed by `(` is a function call and comes back with the
 * paren attached, so `REPLACE(name, …)` or `TRUNCATE(x, 2)` is not mistaken for
 * the statement of the same name.
 */
export function sqlWords(sql: string): string[] {
  const words: string[] = []
  let i = 0
  while (i < sql.length) {
    const ch = sql[i] as string
    const next = sql[i + 1]
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === close) {
          if (sql[j + 1] === close && ch !== '[') {
            j += 2
            continue
          }
          break
        }
        j += 1
      }
      i = j + 1
      continue
    }
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      i = end === -1 ? sql.length : end + 1
      continue
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end === -1 ? sql.length : end + 2
      continue
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        i = end === -1 ? sql.length : end + tag[0].length
        continue
      }
    }
    if (ch === ';') {
      words.push(';')
      i += 1
      continue
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i))
    if (word) {
      i += word[0].length
      const call = /^\s*\(/.test(sql.slice(i))
      words.push(word[0].toLowerCase() + (call ? '(' : ''))
      continue
    }
    i += 1
  }
  return words
}

/**
 * For engines with no read-only transaction of their own (SQL Server,
 * Snowflake), refuse anything that is not a single read statement before it
 * is sent. It is a second line, not the first: a read-only database role is
 * still the real protection, and the error says so.
 */
export function assertReadOnlySql(sql: string, engine: string): void {
  const words = sqlWords(sql)
  while (words[words.length - 1] === ';') words.pop()
  if (words.includes(';')) {
    throw new DatasourceError(`${engine}: one statement per query — remove the extra ";"`)
  }
  const first = words[0]
  if (!first || !READ_STARTS.has(first)) {
    throw new DatasourceError(
      `${engine}: only SELECT / WITH queries can run here (got "${first ?? ''}")`,
    )
  }
  const write = words.find((word) => WRITE_KEYWORDS.has(word))
  if (write) {
    throw new DatasourceError(
      `${engine}: "${write.toUpperCase()}" is not allowed in a dashboard query — dashboards are read-only. If it is a column name, quote it.`,
    )
  }
}

/**
 * Oracle and Snowflake fold unquoted identifiers to upper case, so `AS revenue`
 * comes back as REVENUE and a panel asking for `revenue` finds nothing. Fold an
 * all-caps name back down; a quoted mixed-case name is left exactly as written.
 */
export function foldUpperCase(name: string): string {
  return /[a-z]/.test(name) || !/[A-Z]/.test(name) ? name : name.toLowerCase()
}
