/**
 * Colour by job, as the dataviz rules require: identity takes a categorical
 * slot (never cycled past eight), magnitude one hue light to dark, polarity
 * two opposing hues around a neutral middle. Everything is mixed against the
 * surface, so the same formula reads right in light and dark mode.
 */

/** Categorical slot for the i-th series (0-based). Past the eighth: neutral, never a reused hue. */
export function seriesColor(index: number): string {
  return index >= 0 && index < 8 ? `var(--odd-series-${index + 1})` : 'var(--odd-axis)'
}

/** Magnitude, t in [0, 1]: near-surface for zero, full slot-1 blue at the top. */
export function sequential(t: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  return `color-mix(in srgb, var(--odd-series-1) ${Math.round(8 + clamped * 92)}%, var(--odd-surface))`
}

/** Polarity, t in [-1, 1]: red below zero, blue above, a neutral grey at zero. */
export function diverging(t: number): string {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0))
  if (Math.abs(clamped) < 0.02) return 'var(--odd-surface-2)'
  const hue = clamped > 0 ? 'var(--odd-series-1)' : 'var(--odd-series-8)'
  return `color-mix(in srgb, ${hue} ${Math.round(18 + Math.abs(clamped) * 82)}%, var(--odd-surface))`
}

/** Increase / decrease marks (waterfalls, diverging bars, deltas): the diverging poles. */
export const POSITIVE = 'var(--odd-series-1)'
export const NEGATIVE = 'var(--odd-series-8)'
/** Totals and other marks that are neither up nor down. */
export const NEUTRAL = 'var(--odd-ink-2)'

/** Text on a categorical fill: the ink chosen per slot for contrast. */
export function inkOn(index: number): string {
  return index >= 0 && index < 8 ? `var(--odd-series-${index + 1}-ink)` : 'var(--odd-ink)'
}
