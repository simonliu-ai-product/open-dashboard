/**
 * A theme is a set of `--odd-*` overrides scoped to one dashboard. Every chart
 * draws through those variables, so restyling never touches a component.
 */

export const COLOR_KEYS = ['accent', 'good', 'bad', 'page', 'surface', 'grid'] as const
export type ColorKey = (typeof COLOR_KEYS)[number]
export const SERIES_COUNT = 8

export type ThemeColors = Partial<Record<ColorKey, string>> & { series?: string[] }

export interface DashboardTheme {
  name?: string
  font?: string
  mono?: string
  /** Panel corner radius in px. */
  radius?: number
  light?: ThemeColors
  dark?: ThemeColors
}

export type Mode = 'light' | 'dark'

export const BUILT_IN: Record<Mode, Required<ThemeColors>> & {
  font: string
  mono: string
  radius: number
} = {
  font: 'system-ui, -apple-system, "Segoe UI", "Noto Sans TC", "PingFang TC", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  radius: 10,
  light: {
    series: [
      '#2a78d6',
      '#eb6834',
      '#1baf7a',
      '#eda100',
      '#e87ba4',
      '#008300',
      '#4a3aa7',
      '#e34948',
    ],
    accent: '#2a78d6',
    good: '#006300',
    bad: '#b42f2f',
    page: '#f6f6f3',
    surface: '#fcfcfb',
    grid: '#e8e7e1',
  },
  dark: {
    series: [
      '#3987e5',
      '#d95926',
      '#199e70',
      '#c98500',
      '#d55181',
      '#008300',
      '#9085e9',
      '#e66767',
    ],
    accent: '#3987e5',
    good: '#0ca30c',
    bad: '#e66767',
    page: '#0d0d0d',
    surface: '#1a1a19',
    grid: '#2c2c2a',
  },
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
/** Letters of any script, digits, spaces, quotes, commas, dots and hyphens — never `;{}()<>:` or `\`. */
const FONT = /^[\p{L}\p{N}\s"',._-]{1,200}$/u

/** The theme as written, or an error naming the first field that is wrong. */
export function validateTheme(value: unknown): DashboardTheme {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('a theme is a JSON object')
  const input = value as Record<string, unknown>
  const known = new Set(['name', 'font', 'mono', 'radius', 'light', 'dark'])
  for (const key of Object.keys(input))
    if (!known.has(key)) throw new Error(`unknown theme field "${key}"`)
  const theme: DashboardTheme = {}
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.length > 80)
      throw new Error('"name" must be text of at most 80 characters')
    theme.name = input.name
  }
  for (const key of ['font', 'mono'] as const) {
    const font = input[key]
    if (font === undefined) continue
    if (typeof font !== 'string' || !FONT.test(font))
      throw new Error(`"${key}" must be a CSS font-family list (letters, spaces, quotes, commas)`)
    theme[key] = font
  }
  if (input.radius !== undefined) {
    if (typeof input.radius !== 'number' || !(input.radius >= 0 && input.radius <= 24))
      throw new Error('"radius" must be a number from 0 to 24')
    theme.radius = input.radius
  }
  for (const mode of ['light', 'dark'] as const) {
    if (input[mode] !== undefined) theme[mode] = validateColors(input[mode], mode)
  }
  return theme
}

function validateColors(value: unknown, mode: Mode): ThemeColors {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`"${mode}" must be an object of colours`)
  const input = value as Record<string, unknown>
  const colors: ThemeColors = {}
  for (const key of Object.keys(input)) {
    if (key === 'series') continue
    if (!(COLOR_KEYS as readonly string[]).includes(key))
      throw new Error(`unknown colour "${mode}.${key}"`)
    const color = input[key]
    if (typeof color !== 'string' || !HEX.test(color))
      throw new Error(`"${mode}.${key}" must be a #rgb or #rrggbb colour`)
    colors[key as ColorKey] = color.toLowerCase()
  }
  if (input.series !== undefined) {
    const series = input.series
    if (
      !Array.isArray(series) ||
      series.length === 0 ||
      series.length > SERIES_COUNT ||
      !series.every((c) => typeof c === 'string' && HEX.test(c))
    )
      throw new Error(`"${mode}.series" must be 1 to ${SERIES_COUNT} #rrggbb colours`)
    colors.series = series.map((c: string) => c.toLowerCase())
  }
  return colors
}

function rgb(hex: string): [number, number, number] {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
  return [1, 3, 5].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The text colour for a label drawn on a filled mark: whichever contrasts more. */
export function inkOnColor(hex: string): string {
  const l = luminance(hex)
  const onBlack = (l + 0.05) / 0.05
  const onWhite = 1.05 / (l + 0.05)
  return onBlack >= onWhite ? '#0b0b0b' : '#ffffff'
}

function declarations(colors: ThemeColors | undefined): string[] {
  if (!colors) return []
  const out: string[] = []
  colors.series?.forEach((color, i) => {
    out.push(`--odd-series-${i + 1}:${color}`, `--odd-series-${i + 1}-ink:${inkOnColor(color)}`)
  })
  if (colors.accent)
    out.push(
      `--odd-accent:${colors.accent}`,
      `--odd-accent-ink:color-mix(in srgb,${colors.accent} 80%,var(--odd-ink))`,
    )
  if (colors.good) out.push(`--odd-good:${colors.good}`)
  if (colors.bad) out.push(`--odd-bad:${colors.bad}`, `--odd-critical:${colors.bad}`)
  if (colors.page) out.push(`--odd-page:${colors.page}`)
  if (colors.surface) out.push(`--odd-surface:${colors.surface}`)
  if (colors.grid) out.push(`--odd-grid:${colors.grid}`)
  return out
}

/**
 * CSS for one theme, scoped to `[data-odd-theme="<id>"]`. Each mode's colours
 * sit under the same pair of selectors the stylesheet uses — the system
 * preference and an explicit choice — so a theme that only sets light colours
 * leaves dark mode on the built-in palette instead of a light page in the dark.
 */
export function themeCss(id: string, theme: DashboardTheme): string {
  const scope = `[data-odd-theme="${id.replace(/["\\]/g, '')}"]`
  const shared: string[] = []
  if (theme.font) shared.push(`--odd-font:${theme.font}`, `font-family:${theme.font}`)
  if (theme.mono) shared.push(`--odd-mono:${theme.mono}`)
  if (theme.radius !== undefined) shared.push(`--odd-radius:${theme.radius}px`)
  const light = declarations(theme.light)
  const dark = declarations(theme.dark)
  const rules: string[] = []
  if (shared.length) rules.push(`${scope}{${shared.join(';')}}`)
  if (light.length) {
    rules.push(
      `@media not (prefers-color-scheme: dark){:root:not([data-theme="dark"]) ${scope}{${light.join(';')}}}`,
      `:root[data-theme="light"] ${scope}{${light.join(';')}}`,
    )
  }
  if (dark.length) {
    rules.push(
      `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) ${scope}{${dark.join(';')}}}`,
      `:root[data-theme="dark"] ${scope}{${dark.join(';')}}`,
    )
  }
  return rules.join('\n')
}
