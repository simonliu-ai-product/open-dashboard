import { useState } from 'react'
import { formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import { humanize, MAX_SERIES } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface ScatterChartProps extends PanelProps {
  query: string
  /** Numeric column across. */
  x: string
  /** Numeric column up. */
  y: string
  /** A column naming each point's group — one colour per group. */
  series?: string
  /** A numeric column sizing each point: a bubble chart. */
  size?: string
  /** A column naming each point, for the tooltip. */
  label?: string
  /** Format of y (and of x unless `xFormat` is given). */
  format?: Format
  xFormat?: Format
}

interface Point {
  x: number
  y: number
  r: number
  group: number
  label: string
  size: number | null
}

function Scatter({ run, props }: { run: QueryRun; props: ScatterChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { rows, columns } = run.result
  const numeric = new Set(columns.filter((c) => c.type === 'number').map((c) => c.name))
  if (!numeric.has(props.x) || !numeric.has(props.y)) {
    return (
      <div className="odd-panel-message">{t('A scatter chart needs numeric x and y columns.')}</div>
    )
  }

  const groups: string[] = []
  let overflow = false
  const groupOf = (value: unknown) => {
    const name = value === null || value === undefined ? '—' : String(value)
    let index = groups.indexOf(name)
    if (index === -1) {
      if (groups.length >= MAX_SERIES - 1) {
        overflow = true
        return MAX_SERIES - 1
      }
      groups.push(name)
      index = groups.length - 1
    }
    return index
  }
  const sizes = props.size
    ? rows.map((row) => Number(row[props.size as string])).filter(Number.isFinite)
    : []
  const maxSize = Math.max(1, ...sizes)
  const points: Point[] = rows
    .map((row) => {
      const s = props.size ? Number(row[props.size]) : Number.NaN
      return {
        x: Number(row[props.x]),
        y: Number(row[props.y]),
        r: props.size && Number.isFinite(s) ? 4 + Math.sqrt(Math.max(0, s) / maxSize) * 14 : 4,
        group: props.series ? groupOf(row[props.series]) : 0,
        label: props.label ? String(row[props.label] ?? '') : '',
        size: Number.isFinite(s) ? s : null,
      }
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (overflow) groups.push(t('Other'))

  const xd = niceDomain(
    points.map((p) => p.x),
    5,
    false,
  )
  const yd = niceDomain(
    points.map((p) => p.y),
    5,
    false,
  )
  const xTick = tickFormatter(xd.ticks, props.xFormat ?? props.format, ctx)
  const yTick = tickFormatter(yd.ticks, props.format, ctx)
  const margin = {
    top: 10,
    right: 16,
    bottom: 26,
    left: Math.max(...yd.ticks.map((v) => textWidth(yTick(v)) + 10), 28),
  }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const sx = linear([xd.min, xd.max], [margin.left, margin.left + w])
  const sy = linear([yd.min, yd.max], [margin.top + h, margin.top])
  const active = hover === null ? undefined : points[hover]

  return (
    <div className="odd-chart">
      {groups.length > 1 ? (
        <ul className="odd-legend">
          {groups.map((name, i) => (
            <li key={name}>
              <span
                className="odd-key odd-key-box"
                style={{ background: `var(--odd-series-${i + 1})`, borderRadius: 4 }}
              />
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${humanize(props.y)} by ${humanize(props.x)}`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const px = event.clientX - box.left
              const py = event.clientY - box.top
              let best = -1
              let distance = 24 * 24
              points.forEach((p, i) => {
                const d = (sx(p.x) - px) ** 2 + (sy(p.y) - py) ** 2
                if (d < Math.max(distance, p.r * p.r)) {
                  distance = d
                  best = i
                }
              })
              setHover(best === -1 ? null : best)
            }}
            onPointerLeave={() => setHover(null)}
          >
            {yd.ticks.map((v) => (
              <g key={`y${v}`}>
                <line
                  x1={margin.left}
                  x2={margin.left + w}
                  y1={sy(v)}
                  y2={sy(v)}
                  className="odd-grid-line"
                />
                <text
                  x={margin.left - 6}
                  y={sy(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="odd-tick"
                >
                  {yTick(v)}
                </text>
              </g>
            ))}
            {xd.ticks.map((v) => (
              <g key={`x${v}`}>
                <line
                  x1={sx(v)}
                  x2={sx(v)}
                  y1={margin.top}
                  y2={margin.top + h}
                  className="odd-grid-line"
                />
                <text x={sx(v)} y={margin.top + h + 17} textAnchor="middle" className="odd-tick">
                  {xTick(v)}
                </text>
              </g>
            ))}
            {points.map((p, i) => (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: points are positional and rebuilt every render
                key={i}
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={p.r}
                fill={`var(--odd-series-${p.group + 1})`}
                fillOpacity={props.size ? 0.55 : 0.85}
                className="odd-dot"
                data-dim={hover !== null && hover !== i ? '' : undefined}
              />
            ))}
          </svg>
        ) : null}
        {active ? (
          <ChartTooltip
            left={sx(active.x)}
            top={Math.max(0, sy(active.y) - 30)}
            width={size.width}
            title={
              active.label || (props.series ? (groups[active.group] ?? '') : humanize(props.y))
            }
            rows={[
              {
                label: humanize(props.x),
                value: formatValue(active.x, props.xFormat ?? props.format, ctx),
              },
              { label: humanize(props.y), value: formatValue(active.y, props.format, ctx) },
              ...(props.size && active.size !== null
                ? [{ label: humanize(props.size), value: formatValue(active.size, undefined, ctx) }]
                : []),
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** How two measures move together — one point per row; add `size` for bubbles. */
function ScatterChartPanel(props: ScatterChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="ScatterChart" state={state} defaultHeight={320}>
      {(run) => <Scatter run={run} props={props} />}
    </PanelFrame>
  )
}

export const ScatterChart = editable('ScatterChart', ScatterChartPanel)
