import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { jitter, numbers, quantile } from '../runtime/distribution.js'
import { formatCategory, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { SampleNote } from './histogram.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { edgeRoom, textWidth, thinTicks } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface StripPlotProps extends PanelProps {
  query: string
  /** Raw numeric column, one row per observation. */
  value: string
  /** A category column: one strip per value (up to 20). */
  label?: string
  format?: Format
}

const MAX_POINTS = 2000
const MAX_STRIPS = 20

interface Point {
  value: number
  strip: number
  offset: number
}

function Strips({ run, props }: { run: QueryRun; props: StripPlotProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const names: string[] = []
  const points: Point[] = []
  run.result.rows.forEach((row, i) => {
    if (points.length >= MAX_POINTS) return
    const value = Number(row[props.value])
    if (!Number.isFinite(value) || row[props.value] === null) return
    const name = props.label ? String(row[props.label] ?? '—') : ''
    let strip = names.indexOf(name)
    if (strip === -1) {
      if (names.length >= MAX_STRIPS) return
      names.push(name)
      strip = names.length - 1
    }
    points.push({ value, strip, offset: jitter(i) })
  })
  if (points.length === 0)
    return <div className="odd-panel-message">{t('Needs a numeric value column.')}</div>

  const medians = names.map((_, s) =>
    quantile(numbers(points.filter((p) => p.strip === s).map((p) => p.value)), 0.5),
  )
  const xd = niceDomain(
    points.map((p) => p.value),
    5,
    false,
  )
  const xTick = tickFormatter(xd.ticks, props.format, ctx)
  const labels = names.map((n) => formatCategory(n, ctx, 18))
  const left = names.some(Boolean) ? Math.max(...labels.map((l) => textWidth(l)), 24) + 12 : 12
  const margin = { top: 6, right: edgeRoom(xd.ticks, xTick), bottom: 24, left }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const sx = linear([xd.min, xd.max], [margin.left, margin.left + w])
  const band = h / names.length
  const spread = Math.min(band * 0.7, 60)
  const cy = (p: Point) => margin.top + band * (p.strip + 0.5) + p.offset * spread
  const active = hover === null ? undefined : points[hover]

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('every value as a point')}`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const px = event.clientX - box.left
              const py = event.clientY - box.top
              let best = -1
              let distance = 12 * 12
              points.forEach((p, i) => {
                const d = (sx(p.value) - px) ** 2 + (cy(p) - py) ** 2
                if (d < distance) {
                  distance = d
                  best = i
                }
              })
              setHover(best === -1 ? null : best)
            }}
            onPointerLeave={() => setHover(null)}
          >
            {thinTicks(xd.ticks, xTick, w).map((tick) => (
              <g key={tick}>
                <line
                  x1={sx(tick)}
                  x2={sx(tick)}
                  y1={margin.top}
                  y2={margin.top + h}
                  className="odd-grid-line"
                />
                <text x={sx(tick)} y={margin.top + h + 16} textAnchor="middle" className="odd-tick">
                  {xTick(tick)}
                </text>
              </g>
            ))}
            {names.map((name, s) =>
              name ? (
                // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the filter's own select is the keyboard path
                <text
                  key={name}
                  x={margin.left - 8}
                  y={margin.top + band * (s + 0.5)}
                  dy="0.35em"
                  textAnchor="end"
                  className={
                    drill
                      ? 'odd-tick odd-tick-category odd-drillable'
                      : 'odd-tick odd-tick-category'
                  }
                  onClick={drill ? () => drill.pick(name) : undefined}
                >
                  {labels[s]}
                </text>
              ) : null,
            )}
            {points.map((p, i) => (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: points are positional
                key={i}
                cx={sx(p.value)}
                cy={cy(p)}
                r={3.5}
                fill={seriesColor(0)}
                fillOpacity={0.7}
                className="odd-dot"
                data-dim={
                  (hover !== null && hover !== i) ||
                  (drill?.anyActive && !drill.isActive(names[p.strip]))
                    ? ''
                    : undefined
                }
              />
            ))}
            {medians.map((m, s) =>
              Number.isFinite(m) ? (
                <line
                  key={names[s] || s}
                  x1={sx(m)}
                  x2={sx(m)}
                  y1={margin.top + band * (s + 0.5) - spread / 2 - 4}
                  y2={margin.top + band * (s + 0.5) + spread / 2 + 4}
                  className="odd-median"
                />
              ) : null,
            )}
          </svg>
        ) : null}
        {active ? (
          <ChartTooltip
            left={sx(active.value)}
            top={Math.max(0, cy(active) - 36)}
            width={size.width}
            title={names[active.strip] || props.title}
            rows={[
              { label: t('Value'), value: formatValue(active.value, props.format, ctx) },
              {
                label: t('Median'),
                value: formatValue(medians[active.strip] as number, props.format, ctx),
              },
            ]}
          />
        ) : null}
      </div>
      <SampleNote run={run} />
    </div>
  )
}

/** Every observation as a point, per category — for small samples a box would hide. */
function StripPlotPanel(props: StripPlotProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="StripPlot" state={state} defaultHeight={280}>
      {(run) => <Strips run={run} props={props} />}
    </PanelFrame>
  )
}

export const StripPlot = editable('StripPlot', StripPlotPanel)
