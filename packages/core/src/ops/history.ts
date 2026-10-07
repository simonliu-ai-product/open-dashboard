import { execFile } from 'node:child_process'
import { isAbsolute, relative } from 'node:path'
import { promisify } from 'node:util'
import { parseQueryFile } from '../queries/parse.js'
import type { ResolvedConfig } from '../workspace.js'
import { dashboardQueries } from './dashboards.js'
import { OpsError } from './errors.js'

const run = promisify(execFile)

export interface QueryChange {
  commit: string
  /** ISO 8601, with the author's offset. */
  date: string
  author: string
  subject: string
  /** The hunks of this commit that touch the query, from its first `@@`. */
  diff: string
}

export interface QueryHistory {
  query: string
  file: string
  /** False when the workspace is not in git, or this file was never committed. */
  tracked: boolean
  /** The query on disk differs from the last commit. */
  uncommitted: boolean
  changes: QueryChange[]
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

/** The line span of one query in a query file: its header to the line before the next one. */
function span(
  text: string,
  file: string,
  name: string,
): { start: number; end: number; sql: string } | undefined {
  const queries = parseQueryFile(text, file)
  const index = queries.findIndex((q) => q.name === name)
  const query = queries[index]
  if (!query) return undefined
  const next = queries[index + 1]
  const end = next ? next.line - 1 : text.replace(/\n+$/, '').split('\n').length
  return { start: query.line, end: Math.max(query.line, end), sql: query.sql }
}

const RECORD = '\u001e'
const FIELD = '\u001f'

/**
 * Who changed a metric's definition, when, and how: `git log -L` over the
 * lines the query has in the last commit, so edits to its neighbours in the
 * same file are left out. Author names only — no e-mail addresses. `git` runs
 * without a shell, on a path the server resolved itself.
 */
export async function queryHistory(
  config: ResolvedConfig,
  id: string,
  name: string,
  limit = 10,
): Promise<QueryHistory> {
  const query = dashboardQueries(config, id).get(name)
  if (!query) throw new OpsError(`no query "${name}" in dashboard "${id}"`, 404)
  const file = isAbsolute(query.file) ? relative(config.root, query.file) : query.file
  const empty: QueryHistory = { query: name, file, tracked: false, uncommitted: false, changes: [] }

  let committed: string
  try {
    committed = await git(config.root, ['show', `HEAD:./${file}`])
  } catch {
    // not a repository, no commit yet, or a file never added
    return empty
  }
  let lines: ReturnType<typeof span>
  try {
    lines = span(committed, file, name)
  } catch {
    lines = undefined
  }
  if (!lines) return { ...empty, tracked: true, uncommitted: true }

  const out = await git(config.root, [
    'log',
    `-L${lines.start},${lines.end}:./${file}`,
    `-n${limit}`,
    '--no-color',
    `--format=${RECORD}%h${FIELD}%aI${FIELD}%an${FIELD}%s`,
  ])
  const changes: QueryChange[] = []
  for (const record of out.split(RECORD).slice(1)) {
    const newline = record.indexOf('\n')
    const [commit = '', date = '', author = '', subject = ''] = record
      .slice(0, newline === -1 ? undefined : newline)
      .split(FIELD)
    const body = newline === -1 ? '' : record.slice(newline + 1)
    const hunk = body.indexOf('@@')
    changes.push({
      commit,
      date,
      author,
      subject,
      diff: hunk === -1 ? '' : body.slice(hunk).trimEnd(),
    })
  }
  return { ...empty, tracked: true, uncommitted: lines.sql !== query.sql, changes }
}
