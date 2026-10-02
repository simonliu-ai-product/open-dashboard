import type { ColumnInfo, Row } from '../config.js'

export const MAX_SERIES = 8

export interface Series {
  key: string
  label: string
  values: (number | null)[]
}

export interface Shaped {
  categories: unknown[]
  series: Series[]
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function pickX(columns: ColumnInfo[], x?: string): string | undefined {
  return x ?? columns.find((c) => c.type !== 'number')?.name ?? columns[0]?.name
}

export function pickY(
  columns: ColumnInfo[],
  x: string | undefined,
  y?: string | string[],
  exclude: string[] = [],
): string[] {
  if (y) return Array.isArray(y) ? y : [y]
  return columns
    .filter((c) => c.name !== x && c.type === 'number' && !exclude.includes(c.name))
    .map((c) => c.name)
}

/**
 * Wide rows (one column per series) are used as they are; long rows (a
 * `series` column naming each line) are pivoted. Past eight series the tail is
 * summed into "Other" — a ninth hue is indistinguishable from one already used.
 */
export function shapeSeries(rows: Row[], x: string, y: string[], seriesColumn?: string): Shaped {
  const categories: unknown[] = []
  const index = new Map<string, number>()
  for (const row of rows) {
    const key = String(row[x])
    if (!index.has(key)) {
      index.set(key, categories.length)
      categories.push(row[x])
    }
  }

  let series: Series[]
  if (seriesColumn) {
    const measure = y[0] as string
    const bySeries = new Map<string, Series>()
    for (const row of rows) {
      const label =
        row[seriesColumn] === null || row[seriesColumn] === undefined
          ? '—'
          : String(row[seriesColumn])
      let entry = bySeries.get(label)
      if (!entry) {
        entry = { key: label, label, values: categories.map(() => null) }
        bySeries.set(label, entry)
      }
      const i = index.get(String(row[x])) as number
      const value = toNumber(row[measure])
      entry.values[i] = value === null ? (entry.values[i] ?? null) : (entry.values[i] ?? 0) + value
    }
    series = [...bySeries.values()]
  } else {
    series = y.map((name) => ({ key: name, label: name, values: categories.map(() => null) }))
    for (const row of rows) {
      const i = index.get(String(row[x])) as number
      y.forEach((name, s) => {
        const value = toNumber(row[name])
        const target = series[s] as Series
        target.values[i] =
          value === null ? (target.values[i] ?? null) : (target.values[i] ?? 0) + value
      })
    }
  }

  if (series.length > MAX_SERIES) {
    const total = (s: Series) => s.values.reduce<number>((sum, v) => sum + (v ?? 0), 0)
    const ranked = [...series].sort((a, b) => total(b) - total(a))
    const keep = new Set(ranked.slice(0, MAX_SERIES - 1).map((s) => s.key))
    const other: Series = { key: '__other', label: 'Other', values: categories.map(() => null) }
    for (const s of series) {
      if (keep.has(s.key)) continue
      s.values.forEach((v, i) => {
        if (v !== null) other.values[i] = (other.values[i] ?? 0) + v
      })
    }
    series = [...series.filter((s) => keep.has(s.key)), other]
  }
  return { categories, series }
}

export function humanize(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
