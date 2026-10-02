export interface SankeyLinkInput {
  source: string
  target: string
  value: number
}

export interface SankeyNode {
  name: string
  column: number
  value: number
  x0: number
  x1: number
  y0: number
  y1: number
  /** Categorical slot for the first eight nodes by flow; -1 for the rest. */
  slot: number
}

export interface SankeyLink {
  source: SankeyNode
  target: SankeyNode
  value: number
  /** Vertical centre of the band where it leaves the source and enters the target. */
  sy: number
  ty: number
  width: number
}

export interface SankeyLayout {
  nodes: SankeyNode[]
  links: SankeyLink[]
}

export class SankeyCycleError extends Error {}

/**
 * A small, dependency-free Sankey layout: columns by longest path from a
 * source, node heights proportional to flow, a few passes that pull each node
 * toward the weighted centre of its neighbours, then overlaps pushed apart.
 */
export function sankeyLayout(
  input: SankeyLinkInput[],
  width: number,
  height: number,
  options: { nodeWidth?: number; padding?: number } = {},
): SankeyLayout {
  const nodeWidth = options.nodeWidth ?? 12
  const padding = options.padding ?? 10
  const merged = new Map<string, SankeyLinkInput>()
  for (const link of input) {
    if (!(link.value > 0) || link.source === link.target) continue
    const key = `${link.source}\u0000${link.target}`
    const found = merged.get(key)
    if (found) found.value += link.value
    else merged.set(key, { ...link })
  }
  const links = [...merged.values()]
  const names: string[] = []
  for (const l of links) {
    if (!names.includes(l.source)) names.push(l.source)
    if (!names.includes(l.target)) names.push(l.target)
  }
  const outgoing = new Map(names.map((n) => [n, links.filter((l) => l.source === n)]))
  const incoming = new Map(names.map((n) => [n, links.filter((l) => l.target === n)]))

  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const visit = (name: string): number => {
    if (depth.has(name)) return depth.get(name) as number
    if (visiting.has(name)) throw new SankeyCycleError(name)
    visiting.add(name)
    const preds = incoming.get(name) ?? []
    const d = preds.length === 0 ? 0 : Math.max(...preds.map((l) => visit(l.source) + 1))
    visiting.delete(name)
    depth.set(name, d)
    return d
  }
  for (const n of names) visit(n)
  const columns = Math.max(0, ...depth.values()) + 1

  const value = (n: string) =>
    Math.max(
      (incoming.get(n) ?? []).reduce((s, l) => s + l.value, 0),
      (outgoing.get(n) ?? []).reduce((s, l) => s + l.value, 0),
    )
  const byFlow = [...names].sort((a, b) => value(b) - value(a))
  const nodes = new Map<string, SankeyNode>()
  for (const name of names) {
    const column = depth.get(name) as number
    const x0 = columns === 1 ? 0 : (column / (columns - 1)) * (width - nodeWidth)
    const rank = byFlow.indexOf(name)
    nodes.set(name, {
      name,
      column,
      value: value(name),
      x0,
      x1: x0 + nodeWidth,
      y0: 0,
      y1: 0,
      slot: rank < 8 ? rank : -1,
    })
  }

  const cols = Array.from({ length: columns }, (_, c) =>
    [...nodes.values()].filter((n) => n.column === c),
  )
  const ky = Math.min(
    ...cols.map((col) => {
      const total = col.reduce((s, n) => s + n.value, 0)
      return total > 0
        ? (height - padding * Math.max(0, col.length - 1)) / total
        : Number.POSITIVE_INFINITY
    }),
  )
  const scale = Number.isFinite(ky) && ky > 0 ? ky : 0
  for (const col of cols) {
    let y = 0
    col.sort((a, b) => b.value - a.value)
    for (const n of col) {
      n.y0 = y
      n.y1 = y + n.value * scale
      y = n.y1 + padding
    }
  }

  const centre = (n: SankeyNode) => (n.y0 + n.y1) / 2
  const resolve = (col: SankeyNode[]) => {
    col.sort((a, b) => a.y0 - b.y0)
    let y = 0
    for (const n of col) {
      const shift = y - n.y0
      if (shift > 0) {
        n.y0 += shift
        n.y1 += shift
      }
      y = n.y1 + padding
    }
    const overflow = y - padding - height
    if (overflow > 0) {
      let bottom = height
      for (let i = col.length - 1; i >= 0; i -= 1) {
        const n = col[i] as SankeyNode
        const shift = n.y1 - bottom
        if (shift > 0) {
          n.y0 -= shift
          n.y1 -= shift
        }
        bottom = n.y0 - padding
      }
    }
  }
  for (let pass = 0; pass < 6; pass += 1) {
    const order = pass % 2 === 0 ? cols : [...cols].reverse()
    for (const col of order) {
      for (const n of col) {
        const neighbours = [
          ...(incoming.get(n.name) ?? []).map((l) => ({
            node: nodes.get(l.source) as SankeyNode,
            w: l.value,
          })),
          ...(outgoing.get(n.name) ?? []).map((l) => ({
            node: nodes.get(l.target) as SankeyNode,
            w: l.value,
          })),
        ]
        const weight = neighbours.reduce((s, x) => s + x.w, 0)
        if (weight <= 0) continue
        const target = neighbours.reduce((s, x) => s + centre(x.node) * x.w, 0) / weight
        const shift = (target - centre(n)) * 0.5
        n.y0 += shift
        n.y1 += shift
      }
      resolve(col)
    }
  }

  const out: SankeyLink[] = []
  for (const n of nodes.values()) {
    let sy = n.y0
    for (const l of [...(outgoing.get(n.name) ?? [])].sort(
      (a, b) =>
        centre(nodes.get(a.target) as SankeyNode) - centre(nodes.get(b.target) as SankeyNode),
    )) {
      const w = l.value * scale
      out.push({
        source: n,
        target: nodes.get(l.target) as SankeyNode,
        value: l.value,
        sy: sy + w / 2,
        ty: 0,
        width: w,
      })
      sy += w
    }
  }
  for (const n of nodes.values()) {
    let ty = n.y0
    for (const l of out
      .filter((x) => x.target === n)
      .sort((a, b) => centre(a.source) - centre(b.source))) {
      l.ty = ty + l.width / 2
      ty += l.width
    }
  }
  return { nodes: [...nodes.values()], links: out }
}

/** A link as a closed band between two cubic curves. */
export function linkPath(link: SankeyLink): string {
  const x0 = link.source.x1
  const x1 = link.target.x0
  const mid = (x0 + x1) / 2
  const h = link.width / 2
  return [
    `M${x0},${link.sy - h}`,
    `C${mid},${link.sy - h} ${mid},${link.ty - h} ${x1},${link.ty - h}`,
    `L${x1},${link.ty + h}`,
    `C${mid},${link.ty + h} ${mid},${link.sy + h} ${x0},${link.sy + h}`,
    'Z',
  ].join('')
}
