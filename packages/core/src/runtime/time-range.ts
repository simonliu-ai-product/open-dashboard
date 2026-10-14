import { referenceNow } from './snapshot.js'

export const TIME_PRESETS = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  mtd: 'Month to date',
  ytd: 'Year to date',
  all: 'All time',
} as const

export type TimePreset = keyof typeof TIME_PRESETS

export function isTimePreset(value: unknown): value is TimePreset {
  return typeof value === 'string' && value in TIME_PRESETS
}

const CUSTOM_RANGE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/

export function isCustomTimeRange(value: unknown): value is string {
  return typeof value === 'string' && CUSTOM_RANGE.test(value)
}

export function isTimeValue(value: unknown): value is string {
  return isTimePreset(value) || isCustomTimeRange(value)
}

function day(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDay(text: string): Date {
  const [y, m, d] = text.split('-').map(Number)
  return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1)
}

/**
 * Plain `YYYY-MM-DD` strings with an exclusive end, so `created_at >= :from AND
 * created_at < :to` is right for a DATE column, a TIMESTAMP, and an ISO string
 * in SQLite alike — and "today" includes all of today.
 */
export function resolveTimeRange(
  preset: TimePreset | string,
  now = referenceNow(),
): { from: string; to: string } {
  const custom = CUSTOM_RANGE.exec(preset)
  if (custom) {
    const a = custom[1] as string
    const b = custom[2] as string
    return a <= b ? { from: a, to: b } : { from: b, to: a }
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(start)
  tomorrow.setDate(start.getDate() + 1)
  const back = (days: number) => {
    const d = new Date(tomorrow)
    d.setDate(d.getDate() - days)
    return d
  }
  const monthsBack = (months: number) => {
    const d = new Date(tomorrow)
    d.setMonth(d.getMonth() - months)
    return d
  }
  const key: TimePreset = isTimePreset(preset) ? preset : '30d'
  const from = {
    today: start,
    '7d': back(7),
    '30d': back(30),
    '90d': back(90),
    '6m': monthsBack(6),
    '12m': monthsBack(12),
    mtd: new Date(now.getFullYear(), now.getMonth(), 1),
    ytd: new Date(now.getFullYear(), 0, 1),
    all: null,
  }[key]
  if (!from) return { from: '0001-01-01', to: '9999-12-31' }
  return { from: day(from), to: day(tomorrow) }
}

/** Equal-length period immediately before `[from, to)`. */
export function resolvePreviousRange(
  from: string,
  to: string,
): { prevFrom: string; prevTo: string } {
  if (from === '0001-01-01') return { prevFrom: '0001-01-01', prevTo: '0001-01-01' }
  const start = parseDay(from)
  const end = parseDay(to)
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
  const prevStart = new Date(start)
  prevStart.setDate(prevStart.getDate() - days)
  return { prevFrom: day(prevStart), prevTo: from }
}

export function timeRangeParams(
  name: string | undefined,
  preset: TimePreset | string,
  now?: Date,
  compare?: boolean,
): Record<string, string> {
  const { from, to } = resolveTimeRange(preset, now)
  const base: Record<string, string> = name
    ? { [`${name}_from`]: from, [`${name}_to`]: to }
    : { from, to }
  if (!compare) return base
  const { prevFrom, prevTo } = resolvePreviousRange(from, to)
  return name
    ? { ...base, [`${name}_prev_from`]: prevFrom, [`${name}_prev_to`]: prevTo }
    : { ...base, prev_from: prevFrom, prev_to: prevTo }
}
