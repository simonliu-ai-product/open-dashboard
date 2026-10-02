export interface Tile<T> {
  item: T
  x: number
  y: number
  w: number
  h: number
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((a, b) => a + b, 0)
  const max = Math.max(...row)
  const min = Math.min(...row)
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
}

/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk): rows of tiles laid
 * along the shorter side, each row grown while it keeps tiles closer to square.
 * Items must be sorted largest first; non-positive sizes are dropped.
 */
export function squarify<T>(
  items: { item: T; size: number }[],
  width: number,
  height: number,
): Tile<T>[] {
  const positive = items.filter((i) => i.size > 0)
  const total = positive.reduce((a, b) => a + b.size, 0)
  if (total <= 0 || width <= 0 || height <= 0) return []
  const scale = (width * height) / total
  const areas = positive.map((i) => ({ item: i.item, area: i.size * scale }))
  const out: Tile<T>[] = []
  let x = 0
  let y = 0
  let w = width
  let h = height
  let index = 0
  while (index < areas.length) {
    const side = Math.min(w, h)
    const row: typeof areas = [areas[index] as (typeof areas)[number]]
    index += 1
    while (index < areas.length) {
      const next = areas[index] as (typeof areas)[number]
      const current = row.map((r) => r.area)
      if (worst([...current, next.area], side) > worst(current, side)) break
      row.push(next)
      index += 1
    }
    const sum = row.reduce((a, r) => a + r.area, 0)
    if (w >= h) {
      const thickness = sum / h
      let offset = y
      for (const r of row) {
        const len = r.area / thickness
        out.push({ item: r.item, x, y: offset, w: thickness, h: len })
        offset += len
      }
      x += thickness
      w -= thickness
    } else {
      const thickness = sum / w
      let offset = x
      for (const r of row) {
        const len = r.area / thickness
        out.push({ item: r.item, x: offset, y, w: len, h: thickness })
        offset += len
      }
      y += thickness
      h -= thickness
    }
  }
  return out
}
