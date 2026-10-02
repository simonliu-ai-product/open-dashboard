/** Sorted finite numbers from raw values. */
export function numbers(values: unknown[]): number[] {
  return values
    .map((v) => (typeof v === 'number' ? v : v === null || v === '' ? Number.NaN : Number(v)))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)
}

/** Linear-interpolated quantile of an ascending array (type 7, as in R and NumPy). */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const h = (sorted.length - 1) * Math.max(0, Math.min(1, p))
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  const a = sorted[lo] as number
  return a + ((sorted[hi] as number) - a) * (h - lo)
}

export interface BoxStats {
  n: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  /** Whisker ends: the furthest points within 1.5·IQR of the box. */
  low: number
  high: number
  outliers: number[]
}

export function boxStats(sorted: number[]): BoxStats | undefined {
  if (sorted.length === 0) return undefined
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const iqr = q3 - q1
  const fenceLow = q1 - 1.5 * iqr
  const fenceHigh = q3 + 1.5 * iqr
  const inside = sorted.filter((v) => v >= fenceLow && v <= fenceHigh)
  return {
    n: sorted.length,
    min: sorted[0] as number,
    q1,
    median: quantile(sorted, 0.5),
    q3,
    max: sorted[sorted.length - 1] as number,
    low: inside[0] ?? q1,
    high: inside[inside.length - 1] ?? q3,
    outliers: sorted.filter((v) => v < fenceLow || v > fenceHigh),
  }
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw))
  const f = raw / power
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * power
}

export interface Bin {
  from: number
  to: number
  count: number
}

/**
 * Equal-width bins on round edges. The count defaults to Freedman–Diaconis
 * (robust to outliers, unlike Sturges), clamped to 5–60 so a dashboard panel
 * neither shows three bars nor a comb.
 */
export function histogram(sorted: number[], bins?: number): Bin[] {
  if (sorted.length === 0) return []
  const min = sorted[0] as number
  const max = sorted[sorted.length - 1] as number
  if (min === max) return [{ from: min, to: max, count: sorted.length }]
  let target = bins
  if (!target) {
    const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25)
    const width = (2 * iqr) / Math.cbrt(sorted.length)
    target = width > 0 ? Math.ceil((max - min) / width) : Math.ceil(Math.log2(sorted.length) + 1)
  }
  target = Math.max(5, Math.min(60, Math.round(target)))
  const step = niceStep((max - min) / target)
  const start = Math.floor(min / step) * step
  const count = Math.max(1, Math.ceil((max - start) / step + 1e-9))
  const out: Bin[] = Array.from({ length: count }, (_, i) => ({
    from: Number((start + i * step).toPrecision(12)),
    to: Number((start + (i + 1) * step).toPrecision(12)),
    count: 0,
  }))
  for (const v of sorted) {
    const i = Math.min(count - 1, Math.floor((v - start) / step + 1e-9))
    ;(out[i] as Bin).count += 1
  }
  return out
}

/** Step points of the empirical CDF: share of values ≤ each distinct value. */
export function ecdf(sorted: number[]): { value: number; share: number }[] {
  const out: { value: number; share: number }[] = []
  sorted.forEach((v, i) => {
    const point = { value: v, share: (i + 1) / sorted.length }
    if (out.length && (out[out.length - 1] as { value: number }).value === v)
      out[out.length - 1] = point
    else out.push(point)
  })
  return out
}

export interface ConcentrationStep {
  label: string
  value: number
  /** Cumulative share of entities, 0–1, through this one. */
  entities: number
  /** Cumulative share of the total value, 0–1, through this one. */
  share: number
}

/** Entities largest first, with how much of the whole the top k hold. Non-positive values are dropped. */
export function concentration(items: { label: string; value: number }[]): ConcentrationStep[] {
  const kept = items
    .filter((i) => Number.isFinite(i.value) && i.value > 0)
    .sort((a, b) => b.value - a.value)
  const total = kept.reduce((sum, i) => sum + i.value, 0)
  let running = 0
  return kept.map((item, i) => {
    running += item.value
    return {
      label: item.label,
      value: item.value,
      entities: (i + 1) / kept.length,
      share: running / total,
    }
  })
}

/** Share of the total held by the top `at` (0–1) of entities, interpolated between steps. */
export function shareAt(steps: ConcentrationStep[], at: number): number {
  if (steps.length === 0) return 0
  let prev = { entities: 0, share: 0 }
  for (const step of steps) {
    if (step.entities >= at) {
      const span = step.entities - prev.entities
      return prev.share + (span > 0 ? ((at - prev.entities) / span) * (step.share - prev.share) : 0)
    }
    prev = step
  }
  return 1
}

/** A stable pseudo-random offset in [-0.5, 0.5] for jittering point i. */
export function jitter(i: number): number {
  let x = (i + 1) * 0x9e3779b1
  x ^= x >>> 15
  x = Math.imul(x, 0x85ebca6b)
  x ^= x >>> 13
  return (x >>> 0) / 4294967296 - 0.5
}
