import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { type DashboardTheme, validateTheme } from '../runtime/theme.js'
import type { ResolvedConfig } from '../workspace.js'
import { VALID_ID } from './dashboards.js'
import { OpsError } from './errors.js'
import { hashSource } from './layout.js'

export const THEMES_DIR = 'themes'

export interface ThemeSummary {
  id: string
  name: string
  file: string
}

export interface ThemeFile {
  id: string
  file: string
  /** Of the file as read; a write must send it back. Empty when the theme is new. */
  hash: string
  theme: DashboardTheme
}

export interface ThemeList {
  /** The workspace default from the config, when it names one. */
  default?: string
  themes: ThemeSummary[]
}

function themePath(config: ResolvedConfig, id: string): string {
  if (!VALID_ID.test(id)) throw new OpsError(`"${id}" is not a theme id`)
  return join(config.root, THEMES_DIR, `${id}.json`)
}

function parse(code: string, file: string): DashboardTheme {
  let value: unknown
  try {
    value = JSON.parse(code)
  } catch (error) {
    throw new OpsError(`${file}: not valid JSON — ${(error as Error).message}`, 422)
  }
  try {
    return validateTheme(value)
  } catch (error) {
    throw new OpsError(`${file}: ${(error as Error).message}`, 422)
  }
}

export function listThemes(config: ResolvedConfig): ThemeList {
  const dir = join(config.root, THEMES_DIR)
  const themes: ThemeSummary[] = []
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir).sort()) {
      if (!entry.endsWith('.json')) continue
      const id = entry.slice(0, -'.json'.length)
      if (!VALID_ID.test(id)) continue
      const file = join(dir, entry)
      let name = id
      try {
        name = parse(readFileSync(file, 'utf8'), entry).name ?? id
      } catch {
        // a broken theme still lists, so it can be opened and fixed
      }
      themes.push({ id, name, file: relative(config.root, file) })
    }
  }
  return config.theme ? { default: config.theme, themes } : { themes }
}

export function readTheme(config: ResolvedConfig, id: string): ThemeFile {
  const path = themePath(config, id)
  const file = relative(config.root, path)
  if (!existsSync(path)) throw new OpsError(`no theme "${id}" under ${THEMES_DIR}/`, 404)
  const code = readFileSync(path, 'utf8')
  return { id, file, hash: hashSource(code), theme: parse(code, file) }
}

/**
 * Writes `themes/<id>.json`. `hash` is the one the editor read — '' for a new
 * theme — and a file that changed since (the agent edited it) is refused
 * rather than overwritten.
 */
export function writeTheme(
  config: ResolvedConfig,
  id: string,
  value: unknown,
  hash: string,
): { hash: string } {
  const path = themePath(config, id)
  let theme: DashboardTheme
  try {
    theme = validateTheme(value)
  } catch (error) {
    throw new OpsError((error as Error).message, 422)
  }
  const current = existsSync(path) ? hashSource(readFileSync(path, 'utf8')) : ''
  if (current !== hash) {
    throw new OpsError(
      current && !hash
        ? `a theme "${id}" already exists — pick another id`
        : `${THEMES_DIR}/${id}.json changed on disk since you opened it (your agent may have edited it) — reload to see the new version`,
      409,
    )
  }
  mkdirSync(join(config.root, THEMES_DIR), { recursive: true })
  const code = `${JSON.stringify(theme, null, 2)}\n`
  writeFileSync(path, code)
  return { hash: hashSource(code) }
}

/** The theme id a watched path belongs to, if it is `themes/<id>.json`. */
export function themeIdOf(config: ResolvedConfig, path: string): string | undefined {
  const parts = relative(join(config.root, THEMES_DIR), path).split(sep)
  const name = parts[0]
  if (parts.length !== 1 || !name?.endsWith('.json')) return undefined
  const id = name.slice(0, -'.json'.length)
  return VALID_ID.test(id) ? id : undefined
}
