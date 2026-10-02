import type { FormatContext } from '../runtime/format.js'
import { formatCategory } from '../runtime/format.js'

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/

export function textWidth(text: string): number {
  let width = 4
  for (const ch of text) width += WIDE.test(ch) ? 12 : 6.6
  return width
}

/** Category labels cut to fit `room` pixels, with an ellipsis. */
export function fitLabels(values: unknown[], ctx: FormatContext, room: number): string[] {
  return values.map((value) => {
    let label = formatCategory(value, ctx, 28)
    while (label.length > 3 && textWidth(label) > room) {
      label = `${label.slice(0, label.endsWith('…') ? -2 : -1)}…`
    }
    return label
  })
}

export interface RowBands {
  /** Centre y of row i. */
  center: (i: number) => number
  /** Height of one row's band. */
  band: number
  top: number
  bottom: number
}

/** One horizontal band per category between `top` and `height - bottom`. */
export function rowBands(count: number, height: number, top: number, bottom: number): RowBands {
  const inner = Math.max(0, height - top - bottom)
  const band = inner / Math.max(1, count)
  return { center: (i) => top + band * (i + 0.5), band, top, bottom: top + inner }
}

/**
 * Every k-th tick, so the labels along a horizontal axis of `width` pixels
 * never touch. The first tick is always kept.
 */
export function thinTicks<T>(ticks: T[], label: (tick: T) => string, width: number): T[] {
  if (ticks.length < 3 || width <= 0) return ticks
  const widest = Math.max(...ticks.map((t) => textWidth(label(t))))
  const step = Math.ceil(((widest + 12) * (ticks.length - 1)) / width)
  return step <= 1 ? ticks : ticks.filter((_, i) => i % step === 0)
}

/** Right margin that leaves room for half of the last tick label, centred on the edge. */
export function edgeRoom<T>(ticks: T[], label: (tick: T) => string, min = 16): number {
  const last = ticks[ticks.length - 1]
  return last === undefined ? min : Math.max(min, Math.ceil(textWidth(label(last)) / 2))
}
