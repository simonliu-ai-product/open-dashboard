import type { ParamValue } from '../config.js'

/**
 * `question`: `?` per occurrence (SQLite, MySQL, Snowflake).
 * A function: one placeholder per distinct name, rendered from the name and its
 * 1-based position (`$1`, `@region`, `:p1`, `{p1:String}`), reused on repeats.
 */
export type PlaceholderStyle = 'question' | 'dollar' | ((name: string, index: number) => string)

export interface CompiledSql {
  text: string
  /** One entry per positional placeholder, in order. */
  names: string[]
}

const NAME_START = /[A-Za-z_]/
const NAME_PART = /[A-Za-z0-9_]/

/**
 * Rewrites `:name` placeholders into the driver's positional form. Written as a
 * scanner rather than a regex because a regex cannot tell `:name` from the same
 * text inside a string literal, a comment, or a Postgres `::cast`.
 */
export function compileParams(sql: string, style: PlaceholderStyle): CompiledSql {
  let text = ''
  const names: string[] = []
  const dollarIndex = new Map<string, number>()
  let i = 0

  const copyUntil = (end: string): void => {
    const close = sql.indexOf(end, i)
    const stop = close === -1 ? sql.length : close + end.length
    text += sql.slice(i, stop)
    i = stop
  }

  while (i < sql.length) {
    const ch = sql[i] as string
    const next = sql[i + 1]

    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2
            continue
          }
          break
        }
        j += 1
      }
      text += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '-' && next === '-') {
      copyUntil('\n')
      continue
    }
    if (ch === '/' && next === '*') {
      copyUntil('*/')
      continue
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (tag) {
        text += tag[0]
        i += tag[0].length
        copyUntil(tag[0])
        continue
      }
    }
    if (ch === ':' && next === ':') {
      text += '::'
      i += 2
      continue
    }
    if (ch === ':' && next !== undefined && NAME_START.test(next) && sql[i - 1] !== ':') {
      let j = i + 1
      while (j < sql.length && NAME_PART.test(sql[j] as string)) j += 1
      const name = sql.slice(i + 1, j)
      if (style === 'question') {
        names.push(name)
        text += '?'
      } else {
        let index = dollarIndex.get(name)
        if (index === undefined) {
          names.push(name)
          index = names.length
          dollarIndex.set(name, index)
        }
        text += style === 'dollar' ? `$${index}` : style(name, index)
      }
      i = j
      continue
    }
    text += ch
    i += 1
  }

  return { text, names }
}

export function referencedParams(sql: string): string[] {
  return [...new Set(compileParams(sql, 'dollar').names)]
}

export class MissingParamError extends Error {
  status = 400
  constructor(readonly missing: string[]) {
    super(
      `missing parameter${missing.length > 1 ? 's' : ''} ${missing.map((m) => `:${m}`).join(', ')} — no filter on the dashboard provides ${missing.length > 1 ? 'them' : 'it'}`,
    )
  }
}

export function bindParams(names: string[], values: Record<string, ParamValue>): ParamValue[] {
  const missing = [...new Set(names.filter((name) => !(name in values)))]
  if (missing.length > 0) throw new MissingParamError(missing)
  return names.map((name) => values[name] ?? null)
}
