import type { ColumnInfo, ColumnType, Row } from '../config.js'

const ISO_DATE = /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

function typeOf(value: unknown): ColumnType {
  if (value === null || value === undefined) return 'unknown'
  if (typeof value === 'number' || typeof value === 'bigint') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (value instanceof Date) return 'date'
  if (typeof value === 'string') return ISO_DATE.test(value) ? 'date' : 'string'
  return 'unknown'
}

function plain(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString()
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`
  return value
}

/**
 * Every driver hands back its own value types — bigint from one, Date from
 * another, numeric-as-string from a third. The browser gets one shape, so a
 * chart written against SQLite renders the same against Postgres.
 */
export function normalizeRows(
  rows: Row[],
  names: string[],
): { rows: Row[]; columns: ColumnInfo[] } {
  const out = rows.map((row) => {
    const next: Row = {}
    for (const name of names) next[name] = plain(row[name])
    return next
  })
  const columns = names.map((name) => {
    let type: ColumnType = 'unknown'
    for (const row of rows) {
      const found = typeOf(row[name])
      if (found === 'unknown') continue
      if (type === 'unknown') type = found
      else if (type !== found) {
        type = 'string'
        break
      }
    }
    return { name, type }
  })
  return { rows: out, columns }
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/**
 * A timestamp without a time zone, read back as the clock showed it. Drivers
 * that model such values as UTC Dates (SQL Server by default) put the stored
 * wall-clock time in the UTC fields; formatting those without a zone keeps
 * `09:00` as `09:00` instead of shifting it by the server's offset.
 */
export function wallClock(
  date: Date,
  part: 'date' | 'datetime' | 'time' = 'datetime',
  fields: 'utc' | 'local' = 'utc',
): string {
  const utc = fields === 'utc'
  const y = utc ? date.getUTCFullYear() : date.getFullYear()
  const mo = (utc ? date.getUTCMonth() : date.getMonth()) + 1
  const d = utc ? date.getUTCDate() : date.getDate()
  const h = utc ? date.getUTCHours() : date.getHours()
  const mi = utc ? date.getUTCMinutes() : date.getMinutes()
  const s = utc ? date.getUTCSeconds() : date.getSeconds()
  const ms = utc ? date.getUTCMilliseconds() : date.getMilliseconds()
  const day = `${y}-${pad(mo)}-${pad(d)}`
  const time = `${pad(h)}:${pad(mi)}:${pad(s)}${ms ? `.${pad(ms, 3)}` : ''}`
  if (part === 'date') return day
  if (part === 'time') return time
  return `${day} ${time}`
}

/** Parses `scheme://user:pass@host:port/database?key=value` into its parts. */
export function parseUrl(url: string): {
  user: string
  password: string
  host: string
  port: number | undefined
  database: string
  params: Record<string, string>
} {
  const parsed = new URL(url)
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    params: Object.fromEntries(parsed.searchParams),
  }
}
