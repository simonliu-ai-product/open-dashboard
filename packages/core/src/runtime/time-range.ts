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

function day(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Plain `YYYY-MM-DD` strings with an exclusive end, so `created_at >= :from AND
 * created_at < :to` is right for a DATE column, a TIMESTAMP, and an ISO string
 * in SQLite alike — and "today" includes all of today.
 */
export function resolveTimeRange(
  preset: TimePreset,
  now = new Date(),
): { from: string; to: string } {
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
  }[preset]
  if (!from) return { from: '0001-01-01', to: '9999-12-31' }
  return { from: day(from), to: day(tomorrow) }
}

export function timeRangeParams(name: string | undefined, preset: TimePreset, now?: Date) {
  const { from, to } = resolveTimeRange(preset, now)
  return name ? { [`${name}_from`]: from, [`${name}_to`]: to } : { from, to }
}
