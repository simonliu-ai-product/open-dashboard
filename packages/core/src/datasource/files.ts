import { readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CsvSource, FileTable, JsonFileSource } from '../config.js'
import { jsonSource, pickRows } from './json-tables.js'
import { type Datasource, DatasourceError } from './types.js'

const GLOB = /[*?[{]/

/** `*` within a path segment, `**` across segments, `?` one character. */
export function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string
    if (c === '*' && pattern[i + 1] === '*') {
      out += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += pattern[i + 2] === '/' ? 2 : 1
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

function walk(dir: string, out: string[]): void {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile()) out.push(path)
  }
}

/** Whether `file` (relative to the workspace, `/`-separated) is one a table's pattern reads. */
export function matchesTable(pattern: string, file: string): boolean {
  const normal = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
  return GLOB.test(normal) ? globToRegExp(normal).test(file) : normal === file
}

/**
 * The files a table reads, as paths relative to the workspace, sorted. A
 * pattern resolves only inside the workspace: `..` and absolute paths that
 * leave it are refused, so the config cannot point a page at the disk.
 */
export function tableFiles(root: string, pattern: string): string[] {
  const normal = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
  const absolute = isAbsolute(normal) ? normal : resolve(root, normal)
  const inside = relative(root, absolute)
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new DatasourceError(
      `"${pattern}" is outside the workspace — keep data files under it`,
      500,
    )
  }
  const rel = inside.split(sep).join('/')
  if (!GLOB.test(rel)) return [rel]
  const fixed = rel
    .split('/')
    .filter((_, i, parts) => !parts.slice(0, i + 1).some((p) => GLOB.test(p)))
  const files: string[] = []
  walk(join(root, ...fixed), files)
  const match = globToRegExp(rel)
  return files
    .map((file) => relative(root, file).split(sep).join('/'))
    .filter((file) => match.test(file))
    .sort()
}

/** RFC 4180: quoted fields, doubled quotes, line breaks inside quotes. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '')
}

const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/

/**
 * CSV rows as objects. A column becomes numbers only when every non-empty
 * value is a plain number — `0050`, a code with a leading zero, stays text,
 * as does `1,234`. Empty cells are null.
 */
function csvRows(text: string, delimiter: string): Record<string, unknown>[] {
  const [header, ...lines] = parseCsv(text, delimiter)
  if (!header) return []
  const names = header.map((name, i) => name.trim() || `column${i + 1}`)
  const numeric = names.map((_, i) =>
    lines.every((line) => {
      const value = (line[i] ?? '').trim()
      return value === '' || NUMBER.test(value)
    }),
  )
  return lines.map((line) =>
    Object.fromEntries(
      names.map((name, i) => {
        const value = (line[i] ?? '').trim()
        if (value === '') return [name, null]
        return [name, numeric[i] ? Number(value) : value]
      }),
    ),
  )
}

function jsonRows(text: string, file: string, where: string): unknown {
  if (/\.(jsonl|ndjson)$/i.test(file)) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line, i) => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          throw new DatasourceError(`${where}: ${file} line ${i + 1} is not JSON`)
        }
      })
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new DatasourceError(`${where}: ${file} is not JSON — ${(error as Error).message}`)
  }
}

/**
 * Local JSON (or JSON Lines) and CSV files as tables, read-only by nature:
 * nothing is ever written, and only files under the workspace that the config
 * names are read. A glob stacks every matching file into one table and adds
 * `_file`, its path, so dropping a new file in the folder adds its rows.
 */
export async function openFiles(
  name: string,
  config: JsonFileSource | CsvSource,
  root: string,
): Promise<Datasource> {
  const tables = config.tables ?? {}
  // A file's contents change without its name: the key carries every file's
  // size and mtime, so an edit is read on the next query.
  const signature = (spec: FileTable) =>
    tableFiles(root, spec.file)
      .map((file) => {
        try {
          const stat = statSync(join(root, file))
          return `${file}:${stat.size}:${stat.mtimeMs}`
        } catch {
          return `${file}:missing`
        }
      })
      .join('|')

  return jsonSource<FileTable>({
    name,
    type: config.type,
    tables,
    key: (_table, spec) => signature(spec),
    async fetch(table, spec) {
      const where = `datasource "${name}" table "${table}"`
      const files = tableFiles(root, spec.file)
      const glob = GLOB.test(spec.file)
      if (files.length === 0) throw new DatasourceError(`${where}: no file matches "${spec.file}"`)
      const out: unknown[] = []
      for (const file of files) {
        let text: string
        try {
          text = readFileSync(join(root, file), 'utf8')
        } catch {
          throw new DatasourceError(`${where}: cannot read ${file}`)
        }
        if (config.type === 'csv') {
          const delimiter = config.delimiter ?? (/\.tsv$/i.test(file) ? '\t' : ',')
          const rows = csvRows(text, delimiter)
          out.push(...(glob ? rows.map((row) => ({ _file: file, ...row })) : rows))
          continue
        }
        const body = jsonRows(text, file, where)
        if (!glob) return body
        // Stacked files: each one's rows, picked as for a single file, then tagged.
        out.push(
          ...pickRows(body, spec.rows, `${where} (${file})`).map((row) =>
            row && typeof row === 'object' && !Array.isArray(row)
              ? { _file: file, ...(row as Record<string, unknown>) }
              : { _file: file, value: row },
          ),
        )
      }
      return out
    },
    // Stacked JSON was picked per file above; the stack is already the rows.
    rowsPath: (spec) => (config.type === 'json' && !GLOB.test(spec.file) ? spec.rows : undefined),
  })
}
