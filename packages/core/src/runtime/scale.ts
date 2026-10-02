function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
  return nice * power
}

/**
 * Round ticks that always include zero when the data does not cross it on its
 * own — a bar or area that does not start at zero misstates every value.
 */
export function niceDomain(
  values: number[],
  count = 5,
  includeZero = true,
): { min: number; max: number; ticks: number[] } {
  const finite = values.filter((v) => Number.isFinite(v))
  let min = finite.length ? Math.min(...finite) : 0
  let max = finite.length ? Math.max(...finite) : 1
  if (includeZero) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  if (min === max) {
    if (max === 0) max = 1
    else if (max > 0) min = includeZero ? 0 : max * 0.9
    else max = 0
  }
  const step = niceStep(max - min, count)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step)
    ticks.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12)))
  return { min: lo, max: hi, ticks }
}

export function linear(
  domain: [number, number],
  range: [number, number],
): (value: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  return (value) => r0 + ((value - d0) / span) * (r1 - r0)
}

/** Every nth index so labels never overlap: at most `fit` of them, always the first and last. */
export function thinIndices(count: number, fit: number): number[] {
  if (count <= 0) return []
  if (count <= fit) return Array.from({ length: count }, (_, i) => i)
  const step = Math.ceil(count / Math.max(1, fit))
  const out: number[] = []
  for (let i = 0; i < count; i += step) out.push(i)
  if (out[out.length - 1] !== count - 1) {
    if (count - 1 - (out[out.length - 1] as number) < step) out.pop()
    out.push(count - 1)
  }
  return out
}
