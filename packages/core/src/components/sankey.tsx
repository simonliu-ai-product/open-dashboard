import { useState } from 'react'
import { NEUTRAL, seriesColor } from '../runtime/color.js'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linkPath, SankeyCycleError, type SankeyLayout, sankeyLayout } from '../runtime/sankey.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface SankeyProps extends PanelProps {
  query: string
  /** Where a flow starts. */
  source: string
  /** Where it goes. A target can be the source of the next stage. */
  target: string
  /** How much flows. */
  value: string
  format?: Format
}

const LABEL_ROOM = 120
const LABEL_GAP = 14

function Flows({ run, props }: { run: QueryRun; props: SankeyProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hoverNode, setHoverNode] = useState<string | null>(null)
  const [hoverLink, setHoverLink] = useState<number | null>(null)
  const input = run.result.rows.map((row) => ({
    source: String(row[props.source] ?? '—'),
    target: String(row[props.target] ?? '—'),
    value: Number(row[props.value]),
  }))
  if (input.every((l) => !(l.value > 0))) {
    return (
      <div className="odd-panel-message">
        {t('Needs source, target and a positive value column.')}
      </div>
    )
  }

  let layout: SankeyLayout
  const inner = { left: 4, right: 4, top: 6, bottom: 6 }
  const width = Math.max(0, size.width - inner.left - inner.right)
  const height = Math.max(0, size.height - inner.top - inner.bottom)
  try {
    layout = sankeyLayout(input, width, height)
  } catch (error) {
    if (error instanceof SankeyCycleError) {
      return (
        <div className="odd-panel-message">
          {t('These flows loop back on themselves; a Sankey needs flows that only move forward.')}
        </div>
      )
    }
    throw error
  }
  const lastColumn = Math.max(0, ...layout.nodes.map((n) => n.column))
  // Small nodes sit close together: move their labels apart so they never print
  // on top of each other, keeping each as near its node as there is room for.
  const labelY = new Map<string, number>()
  const byColumn = new Map<number, typeof layout.nodes>()
  for (const n of layout.nodes) byColumn.set(n.column, [...(byColumn.get(n.column) ?? []), n])
  for (const nodes of byColumn.values()) {
    const sorted = [...nodes].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1))
    let previous = -Infinity
    for (const n of sorted) {
      const y = Math.max((n.y0 + n.y1) / 2, previous + LABEL_GAP)
      labelY.set(n.name, y)
      previous = y
    }
    // Pushed past the bottom: shift the whole run back up.
    const overflow = previous - (height - 4)
    if (overflow > 0) {
      for (const n of sorted) labelY.set(n.name, (labelY.get(n.name) as number) - overflow)
    }
  }
  const colour = (slot: number) => (slot >= 0 ? seriesColor(slot) : NEUTRAL)
  const lit = (source: string, target: string) =>
    hoverNode === null || hoverNode === source || hoverNode === target
  const link = hoverLink === null ? undefined : layout.links[hoverLink]
  const node = layout.nodes.find((n) => n.name === hoverNode)

  // A label may run as far as the next column's nodes, less a gap; past that it
  // loses its value, then letters.
  const room = (n: (typeof layout.nodes)[number]): number => {
    const next = byColumn.get(n.column + 1)
    if (!next) return Number.POSITIVE_INFINITY
    let edge = Math.min(...next.map((m) => m.x0))
    // The last column's labels sit to the left of their nodes, in this gap.
    if (n.column + 1 === lastColumn) {
      const y = labelY.get(n.name) as number
      for (const m of next) {
        if (Math.abs((labelY.get(m.name) as number) - y) >= LABEL_GAP) continue
        const full = `${m.name} ${formatValue(m.value, props.format ?? 'compact', ctx)}`
        edge = Math.min(edge, m.x0 - 6 - textWidth(full))
      }
    }
    return edge - n.x1 - 12
  }
  const fitLabel = (n: (typeof layout.nodes)[number]): { name: string; value: string } => {
    const value = ` ${formatValue(n.value, props.format ?? 'compact', ctx)}`
    const space = n.column === lastColumn && lastColumn > 0 ? Number.POSITIVE_INFINITY : room(n)
    if (textWidth(n.name + value) <= space) return { name: n.name, value }
    let name = n.name
    while (name.length > 1 && textWidth(`${name}…`) > space) name = name.slice(0, -1)
    return { name: name === n.name ? name : `${name}…`, value: '' }
  }
  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > LABEL_ROOM ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('flows between stages')}`}
          >
            <g transform={`translate(${inner.left},${inner.top})`}>
              {layout.links.map((l, i) => (
                <path
                  key={`${l.source.name}→${l.target.name}`}
                  d={linkPath(l)}
                  fill={colour(l.source.slot)}
                  className="odd-sankey-link"
                  data-dim={
                    (hoverLink !== null && hoverLink !== i) || !lit(l.source.name, l.target.name)
                      ? ''
                      : undefined
                  }
                  data-lit={
                    (hoverNode !== null && lit(l.source.name, l.target.name)) || hoverLink === i
                      ? ''
                      : undefined
                  }
                  onPointerEnter={() => setHoverLink(i)}
                  onPointerLeave={() => setHoverLink(null)}
                />
              ))}
              {layout.nodes.map((n) => {
                const right = n.column === lastColumn && lastColumn > 0
                return (
                  <g
                    key={n.name}
                    onPointerEnter={() => setHoverNode(n.name)}
                    onPointerLeave={() => setHoverNode(null)}
                  >
                    <rect
                      x={n.x0}
                      y={n.y0}
                      width={n.x1 - n.x0}
                      height={Math.max(1, n.y1 - n.y0)}
                      rx={2}
                      fill={colour(n.slot)}
                      className="odd-sankey-node"
                    />
                    <text
                      x={right ? n.x0 - 6 : n.x1 + 6}
                      y={labelY.get(n.name)}
                      dy="0.35em"
                      textAnchor={right ? 'end' : 'start'}
                      className="odd-sankey-label"
                    >
                      {fitLabel(n).name}
                      <tspan className="odd-sankey-value">{fitLabel(n).value}</tspan>
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        ) : null}
        {link ? (
          <ChartTooltip
            left={(link.source.x1 + link.target.x0) / 2}
            top={Math.max(0, (link.sy + link.ty) / 2 - 20)}
            width={size.width}
            title={`${link.source.name} → ${link.target.name}`}
            rows={[
              { label: t('Value'), value: formatValue(link.value, props.format, ctx) },
              {
                label: t('Share of {name}', { name: link.source.name }),
                value: formatValue(link.value / (link.source.value || 1), 'percent', ctx),
              },
            ]}
          />
        ) : node ? (
          <ChartTooltip
            left={(node.x0 + node.x1) / 2}
            top={Math.max(0, node.y0 - 10)}
            width={size.width}
            title={node.name}
            rows={[{ label: t('Flow'), value: formatValue(node.value, props.format, ctx) }]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Where things go next: flows that split and merge across stages. */
function SankeyPanel(props: SankeyProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Sankey" state={state} defaultHeight={360}>
      {(run) => <Flows run={run} props={props} />}
    </PanelFrame>
  )
}

export const Sankey = editable('Sankey', SankeyPanel)
