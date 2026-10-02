export interface WaterfallInput {
  label: string
  value: number
  total?: boolean
}

export interface WaterfallStep {
  label: string
  /** Where the bar starts and ends on the value axis. */
  from: number
  to: number
  kind: 'total' | 'up' | 'down'
}

/**
 * Bars of a bridge chart. A total is drawn from zero and resets the running
 * sum; a delta floats from the running sum. Without explicit totals the first
 * row opens the bridge and a closing total is appended.
 */
export function waterfallSteps(rows: WaterfallInput[], closing?: string): WaterfallStep[] {
  const explicit = rows.some((row) => row.total)
  const steps: WaterfallStep[] = []
  let running = 0
  rows.forEach((row, index) => {
    const isTotal = explicit ? Boolean(row.total) : index === 0
    if (isTotal) {
      running = row.value
      steps.push({ label: row.label, from: 0, to: row.value, kind: 'total' })
    } else {
      steps.push({
        label: row.label,
        from: running,
        to: running + row.value,
        kind: row.value >= 0 ? 'up' : 'down',
      })
      running += row.value
    }
  })
  if (!explicit && closing !== undefined && rows.length > 0) {
    steps.push({ label: closing, from: 0, to: running, kind: 'total' })
  }
  return steps
}

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDay(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return undefined
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

export interface CalendarCell {
  date: string
  /** Week column, 0 = the first week shown. */
  col: number
  /** Weekday row, 0 = Monday. */
  row: number
  value: number | undefined
}

export interface CalendarLayout {
  weeks: number
  cells: CalendarCell[]
  /** The column where each month first appears, for labels. */
  months: { col: number; date: string }[]
}

/**
 * Weeks as columns, Monday-first weekdays as rows, ending on the latest date in
 * the data and reaching back at most `maxWeeks`. Days inside the window with no
 * row still get a cell, with no value.
 */
export function calendarLayout(values: Map<string, number>, maxWeeks = 53): CalendarLayout {
  const days = [...values.keys()].map(parseDay).filter((d): d is Date => d !== undefined)
  if (days.length === 0) return { weeks: 0, cells: [], months: [] }
  const last = new Date(Math.max(...days.map((d) => d.getTime())))
  const first = new Date(Math.min(...days.map((d) => d.getTime())))
  const mondayOf = (d: Date) => {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
    return m
  }
  const lastMonday = mondayOf(last)
  let start = mondayOf(first)
  const earliest = new Date(lastMonday)
  earliest.setDate(earliest.getDate() - (maxWeeks - 1) * 7)
  if (start < earliest) start = earliest
  const cells: CalendarCell[] = []
  const months: { col: number; date: string }[] = []
  let col = 0
  for (const cursor = new Date(start); cursor <= last; col += 1) {
    for (let row = 0; row < 7 && cursor <= last; row += 1) {
      const key = dayKey(cursor)
      if (cursor.getDate() === 1 || (col === 0 && row === 0))
        months.push({ col: cursor.getDate() === 1 && row > 0 ? col + 1 : col, date: key })
      cells.push({ date: key, col, row, value: values.get(key) })
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  const seen = new Set<number>()
  return {
    weeks: col,
    cells,
    months: months.filter((m) => m.col < col && !seen.has(m.col) && seen.add(m.col)),
  }
}

export interface ControlLimits {
  center: number
  upper: number
  lower: number
}

/** Mean ± 3 standard deviations (sample), the Shewhart default. */
export function controlLimits(values: number[]): ControlLimits {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return { center: 0, upper: 0, lower: 0 }
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length
  const variance =
    finite.length > 1
      ? finite.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (finite.length - 1)
      : 0
  const sigma = Math.sqrt(variance)
  return { center: mean, upper: mean + 3 * sigma, lower: mean - 3 * sigma }
}

/**
 * How full each horizon band is for one value: a value at 2.5 bands of a
 * 3-band chart fills band 0 and 1 completely and band 2 halfway.
 */
export function horizonFill(value: number, max: number, bands: number): number[] {
  if (!(max > 0) || !(value > 0)) return Array.from({ length: bands }, () => 0)
  const scaled = (Math.min(value, max) / max) * bands
  return Array.from({ length: bands }, (_, band) => Math.max(0, Math.min(1, scaled - band)))
}

export type DurationUnit = 'seconds' | 'minutes' | 'hours' | 'days'

/** The largest unit that keeps the number at or above one, rounded to one decimal under 10. */
export function humanDuration(ms: number): { n: number; unit: DurationUnit } {
  const seconds = Math.max(0, ms) / 1000
  const pick = (n: number, unit: DurationUnit) => ({
    n: n < 10 ? Math.round(n * 10) / 10 : Math.round(n),
    unit,
  })
  if (seconds < 60) return pick(seconds, 'seconds')
  if (seconds < 3600) return pick(seconds / 60, 'minutes')
  if (seconds < 86400) return pick(seconds / 3600, 'hours')
  return pick(seconds / 86400, 'days')
}

/** Parse a date or datetime string as local wall-clock time. */
export function parseTime(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (!match) return undefined
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? 0),
    Number(match[5] ?? 0),
    Number(match[6] ?? 0),
  ).getTime()
}

/** Round ticks across a time span: hours, days, weeks or months depending on its length. */
export function timeTicks(min: number, max: number, count = 6): number[] {
  if (!(max > min)) return [min]
  const span = max - min
  const hour = 3600_000
  const day = 24 * hour
  const steps = [hour, 3 * hour, 6 * hour, 12 * hour, day, 2 * day, 7 * day, 14 * day]
  const fitting = steps.findIndex((s) => span / s <= count)
  if (fitting >= 0) {
    const at = (step: number) => {
      const first = new Date(min)
      if (step >= day) first.setHours(0, 0, 0, 0)
      else first.setMinutes(0, 0, 0)
      const ticks: number[] = []
      for (let t = first.getTime(); t <= max; t += step) if (t >= min) ticks.push(t)
      return ticks
    }
    // A coarse step can land a single tick in a short span (one midnight in a
    // four-hour window): step down until there are two, if any step gives two.
    for (let i = fitting; i >= 0; i -= 1) {
      const ticks = at(steps[i] as number)
      if (ticks.length >= 2 || i === 0) return ticks
    }
  }
  const months = Math.max(1, Math.ceil(span / (30 * day) / count))
  const cursor = new Date(min)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  const ticks: number[] = []
  while (cursor.getTime() <= max) {
    if (cursor.getTime() >= min) ticks.push(cursor.getTime())
    cursor.setMonth(cursor.getMonth() + months)
  }
  return ticks
}

/**
 * A formatter for `timeTicks` output, chosen by where the ticks fall rather
 * than the span: 12-hourly ticks over three days need the hour as well as the
 * date, or every other label repeats.
 */
export function timeTickFormat(ticks: number[], locale: string | undefined): Intl.DateTimeFormat {
  const dates = ticks.map((t) => new Date(t))
  const midnight = dates.every((d) => d.getHours() === 0 && d.getMinutes() === 0)
  const monthly = midnight && dates.length > 1 && dates.every((d) => d.getDate() === 1)
  if (monthly) return new Intl.DateTimeFormat(locale, { year: '2-digit', month: 'short' })
  if (midnight) return new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' })
  const first = dates[0]
  const last = dates[dates.length - 1]
  const oneDay = !first || !last || first.toDateString() === last.toDateString()
  return new Intl.DateTimeFormat(
    locale,
    oneDay
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  )
}
