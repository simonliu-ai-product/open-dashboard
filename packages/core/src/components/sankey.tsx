import { useState } from 'react'
import { NEUTRAL, seriesColor } from '../runtime/color.js'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linkPath, SankeyCycleError, type SankeyLayout, sankeyLayout } from '../runtime/sankey.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
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
  const colour = (slot: number) => (slot >= 0 ? seriesColor(slot) : NEUTRAL)
  const lit = (source: string, target: string) =>
    hoverNode === null || hoverNode === source || hoverNode === target
  const link = hoverLink === null ? undefined : layout.links[hoverLink]
  const node = layout.nodes.find((n) => n.name === hoverNode)

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
                      y={(n.y0 + n.y1) / 2}
                      dy="0.35em"
                      textAnchor={right ? 'end' : 'start'}
                      className="odd-sankey-label"
                    >
                      {n.name}
                      <tspan className="odd-sankey-value">{` ${formatValue(n.value, props.format ?? 'compact', ctx)}`}</tspan>
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
