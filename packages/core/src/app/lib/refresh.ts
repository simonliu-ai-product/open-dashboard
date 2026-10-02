import type { Translate } from '../../runtime/i18n.js'

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000 }

export const REFRESH_OPTIONS = ['off', '30s', '1m', '2m', '5m', '10m', '15m', '30m', '1h'] as const

/** '30s' → 30000. Anything under 5s is raised to 5s: a dashboard is not a load test. */
export function parseInterval(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^(\d+)\s*([smh])$/.exec(value.trim())
  if (!match) return undefined
  return Math.max(5000, Number(match[1]) * (UNITS[match[2] as string] as number))
}

export function intervalLabel(value: string, t: Translate): string {
  if (value === 'off') return t('Off')
  const match = /^(\d+)\s*([smh])$/.exec(value.trim())
  if (!match) return value
  const n = Number(match[1])
  if (match[2] === 's') return t('Every {n} sec', { n })
  if (match[2] === 'h') return n === 1 ? t('Every hour') : t('Every {n} hours', { n })
  return n === 1 ? t('Every minute') : t('Every {n} min', { n })
}

/**
 * The reader's choice lives in the URL beside the filters, so a wall-display
 * link keeps its interval. `meta.refresh` is only the default.
 */
export function readRefresh(fallback: string | undefined): string {
  const fromUrl = new URLSearchParams(window.location.search).get('refresh')
  if (fromUrl && (fromUrl === 'off' || parseInterval(fromUrl))) return fromUrl
  return fallback && parseInterval(fallback) ? fallback : 'off'
}

export function writeRefresh(value: string, fallback: string | undefined): void {
  const url = new URL(window.location.href)
  const normal = fallback && parseInterval(fallback) ? fallback : 'off'
  if (value === normal) url.searchParams.delete('refresh')
  else url.searchParams.set('refresh', value)
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
}
