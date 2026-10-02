import type { Format } from './types.js'

export interface FormatContext {
  locale: string
  currency: string
}

const cache = new Map<string, Intl.NumberFormat>()

function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let found = cache.get(key)
  if (!found) {
    found = new Intl.NumberFormat(locale, options)
    cache.set(key, found)
  }
  return found
}

const MONTH = /^(\d{4})-(\d{2})$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})/

export function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const month = MONTH.exec(value)
  if (month) return new Date(Number(month[1]), Number(month[2]) - 1, 1)
  const day = DAY.exec(value)
  if (day) {
    if (value.length > 10) {
      const parsed = new Date(value.replace(' ', 'T'))
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
    return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]))
  }
  return undefined
}

export function isDateLike(value: unknown): boolean {
  return typeof value === 'string' && (MONTH.test(value) || DAY.test(value))
}

const TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/

function hasTime(value: unknown): boolean {
  return typeof value === 'string' && TIME.test(value)
}

function formatDate(value: unknown, ctx: FormatContext, style: 'date' | 'month' | 'auto'): string {
  const date = parseDate(value)
  if (!date) return String(value)
  if (style === 'auto' && hasTime(value)) {
    return new Intl.DateTimeFormat(ctx.locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date)
  }
  const monthOnly =
    style === 'month' || (style === 'auto' && typeof value === 'string' && MONTH.test(value))
  if (monthOnly)
    return new Intl.DateTimeFormat(ctx.locale, { year: 'numeric', month: 'short' }).format(date)
  return new Intl.DateTimeFormat(ctx.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function options(format: Format, value: number, ctx: FormatContext): Intl.NumberFormatOptions {
  if (typeof format === 'object') return format
  switch (format) {
    case 'integer':
      return { maximumFractionDigits: 0 }
    case 'decimal':
      return { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    case 'compact':
      return { notation: 'compact', maximumFractionDigits: 1 }
    case 'currency':
      return {
        style: 'currency',
        currency: ctx.currency,
        maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
      }
    case 'currencyCompact':
      return {
        style: 'currency',
        currency: ctx.currency,
        notation: 'compact',
        maximumFractionDigits: 1,
      }
    case 'percent':
      return { style: 'percent', maximumFractionDigits: Math.abs(value) < 0.1 ? 1 : 0 }
    default:
      return { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }
  }
}

export function formatValue(
  value: unknown,
  format: Format | undefined,
  ctx: FormatContext,
): string {
  if (value === null || value === undefined || value === '') return '—'
  if (format === 'text') return String(value)
  if (format === 'date' || format === 'month') return formatDate(value, ctx, format)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value)
    return numberFormat(ctx.locale, options(format ?? 'number', value, ctx)).format(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (!format && isDateLike(value)) return formatDate(value, ctx, 'auto')
  return String(value)
}

/**
 * One formatter for a whole axis, so every tick reads the same way: compact
 * once the largest tick needs it, and no decimals when no tick has any.
 */
export function tickFormatter(
  ticks: number[],
  format: Format | undefined,
  ctx: FormatContext,
): (value: number) => string {
  const largest = Math.max(0, ...ticks.map((t) => Math.abs(t)))
  const whole = ticks.every((t) => Number.isInteger(t))
  // Chinese, Japanese and Korean compact in units of 10⁴ (萬, 万, 만): below
  // that a tick stays a plain number, so an axis would read 8000 under 1萬.
  // There, go compact only when every non-zero tick can be.
  const myriad = /^(zh|ja|ko)\b/i.test(ctx.locale ?? '')
  const compact = myriad
    ? largest >= 10_000 && ticks.every((t) => t === 0 || Math.abs(t) >= 10_000)
    : largest >= 10_000
  if (format === 'percent') {
    const digits = ticks.every((t) => Number.isInteger(Math.round(t * 1e6) / 1e4)) ? 0 : 1
    return (value) => formatValue(value, { style: 'percent', maximumFractionDigits: digits }, ctx)
  }
  const base: Intl.NumberFormatOptions =
    typeof format === 'object'
      ? { ...format }
      : format === 'currency' || format === 'currencyCompact'
        ? { style: 'currency', currency: ctx.currency }
        : {}
  const options: Intl.NumberFormatOptions = compact
    ? { ...base, notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 }
    : { ...base, maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: 0 }
  return (value) => formatValue(value, options, ctx)
}

/** A single value outside an axis — a bar-end label: compact past ten thousand. */
export function formatShort(value: number, format: Format | undefined, ctx: FormatContext): string {
  if (Math.abs(value) >= 10_000) return tickFormatter([value], format, ctx)(value)
  return formatValue(value, format, ctx)
}

/** A short category label for an axis: dates abbreviated, long names cut. */
export function formatCategory(value: unknown, ctx: FormatContext, max = 18): string {
  if (isDateLike(value)) {
    const date = parseDate(value) as Date
    const text = value as string
    if (MONTH.test(text))
      return new Intl.DateTimeFormat(ctx.locale, { month: 'short', year: '2-digit' }).format(date)
    if (hasTime(text)) {
      return new Intl.DateTimeFormat(ctx.locale, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(date)
    }
    return new Intl.DateTimeFormat(ctx.locale, { month: 'short', day: 'numeric' }).format(date)
  }
  const text = value === null || value === undefined ? '—' : String(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
