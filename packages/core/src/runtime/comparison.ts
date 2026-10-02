import type { Row } from '../config.js'

/** A number written in the props, or the named column of the row. */
export function readRef(row: Row, ref: number | string | undefined): number | undefined {
  if (typeof ref === 'number') return Number.isFinite(ref) ? ref : undefined
  if (typeof ref === 'string') {
    const n = Number(row[ref])
    return row[ref] === null || row[ref] === undefined || !Number.isFinite(n) ? undefined : n
  }
  return undefined
}

export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Spread label positions so no two are closer than `gap`, keeping their order
 * and staying inside [min, max]. Labels are pushed down from the top, then
 * back up from the bottom, so a crowd at either end still fits.
 */
export function declutter(wanted: number[], gap: number, min: number, max: number): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i)
  const placed = order.map((o) => Math.max(min, Math.min(max, o.y)))
  for (let k = 1; k < placed.length; k += 1) {
    placed[k] = Math.max(placed[k] as number, (placed[k - 1] as number) + gap)
  }
  const last = placed.length - 1
  if (last >= 0 && (placed[last] as number) > max) {
    placed[last] = max
    for (let k = last - 1; k >= 0; k -= 1) {
      placed[k] = Math.min(placed[k] as number, (placed[k + 1] as number) - gap)
    }
  }
  const out = new Array<number>(wanted.length)
  order.forEach((o, k) => {
    out[o.i] = placed[k] as number
  })
  return out
}

export interface BumpEntity {
  name: string
  ranks: (number | null)[]
  values: (number | null)[]
}

export interface BumpData {
  categories: unknown[]
  entities: BumpEntity[]
  /** The deepest rank drawn — the axis runs 1..maxRank. */
  maxRank: number
}

/**
 * Rank every entity within each x by value (1 = highest, or lowest when
 * ascending), ties sharing a rank. Only entities that reach the top `top` at
 * least once are kept; their ranks outside the top are still drawn so a line
 * can be followed falling out and back in.
 */
export function bumpRanks(
  rows: Row[],
  x: string,
  series: string,
  value: string,
  options: { ascending?: boolean; top?: number } = {},
): BumpData {
  const top = Math.max(1, options.top ?? 8)
  const categories: unknown[] = []
  const index = new Map<string, number>()
  const values = new Map<string, Map<number, number>>()
  for (const row of rows) {
    const key = String(row[x])
    if (!index.has(key)) {
      index.set(key, categories.length)
      categories.push(row[x])
    }
    const n = toNumber(row[value])
    if (n === undefined) continue
    const name = row[series] === null || row[series] === undefined ? '—' : String(row[series])
    let byX = values.get(name)
    if (!byX) {
      byX = new Map()
      values.set(name, byX)
    }
    const i = index.get(key) as number
    byX.set(i, (byX.get(i) ?? 0) + n)
  }

  const ranks = new Map<string, (number | null)[]>()
  for (const name of values.keys())
    ranks.set(
      name,
      categories.map(() => null),
    )
  categories.forEach((_, i) => {
    const present = [...values]
      .filter(([, byX]) => byX.has(i))
      .map(([name, byX]) => ({ name, n: byX.get(i) as number }))
    present.sort((a, b) => (options.ascending ? a.n - b.n : b.n - a.n))
    let rank = 0
    let previous: number | undefined
    present.forEach((entry, k) => {
      if (entry.n !== previous) rank = k + 1
      previous = entry.n
      ;(ranks.get(entry.name) as (number | null)[])[i] = rank
    })
  })

  const entities = [...ranks]
    .filter(([, r]) => r.some((v) => v !== null && v <= top))
    .map(([name, r]) => ({
      name,
      ranks: r,
      values: categories.map((_, i) => values.get(name)?.get(i) ?? null),
    }))
  const lastRank = (e: BumpEntity) => {
    for (let i = e.ranks.length - 1; i >= 0; i -= 1)
      if (e.ranks[i] !== null) return e.ranks[i] as number
    return Number.POSITIVE_INFINITY
  }
  entities.sort((a, b) => lastRank(a) - lastRank(b) || a.name.localeCompare(b.name))
  const deepest = Math.max(
    0,
    ...entities.flatMap((e) => e.ranks.filter((r): r is number => r !== null)),
  )
  return { categories, entities, maxRank: Math.max(1, Math.min(deepest, top + 2)) }
}

export interface MekkoSegment {
  series: string
  value: number
  /** Share of its column, and its vertical extent as fractions of the column. */
  share: number
  y0: number
  y1: number
}

export interface MekkoColumn {
  key: unknown
  total: number
  /** Horizontal extent as fractions of the whole width. */
  x0: number
  x1: number
  segments: MekkoSegment[]
}

export interface MekkoData {
  columns: MekkoColumn[]
  series: string[]
  total: number
}

/**
 * Columns as wide as their share of the grand total, each split top to bottom
 * by its segments' shares. Segments keep one series order across columns (the
 * order they first appear), so a colour sits at the same height everywhere.
 */
export function marimekko(rows: Row[], x: string, series: string, value: string): MekkoData {
  const keys: unknown[] = []
  const series_: string[] = []
  const cells = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const n = toNumber(row[value])
    if (n === undefined || n <= 0) continue
    const key = String(row[x])
    if (!cells.has(key)) {
      cells.set(key, new Map())
      keys.push(row[x])
    }
    const name = row[series] === null || row[series] === undefined ? '—' : String(row[series])
    if (!series_.includes(name)) series_.push(name)
    const column = cells.get(key) as Map<string, number>
    column.set(name, (column.get(name) ?? 0) + n)
  }
  const totals = keys.map((key) =>
    [...(cells.get(String(key)) as Map<string, number>).values()].reduce((a, b) => a + b, 0),
  )
  const total = totals.reduce((a, b) => a + b, 0)
  let x0 = 0
  const columns = keys.map((key, i) => {
    const columnTotal = totals[i] as number
    const width = total > 0 ? columnTotal / total : 0
    let y0 = 0
    const segments: MekkoSegment[] = []
    for (const name of series_) {
      const v = (cells.get(String(key)) as Map<string, number>).get(name)
      if (v === undefined) continue
      const share = columnTotal > 0 ? v / columnTotal : 0
      segments.push({ series: name, value: v, share, y0, y1: y0 + share })
      y0 += share
    }
    const column = { key, total: columnTotal, x0, x1: x0 + width, segments }
    x0 += width
    return column
  })
  return { columns, series: series_, total }
}
