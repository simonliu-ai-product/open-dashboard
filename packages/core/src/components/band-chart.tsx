import { useState } from 'react'
import { POSITIVE } from '../runtime/color.js'
import { formatCategory, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain, thinIndices } from '../runtime/scale.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface BandChartProps extends PanelProps {
  query: string
  /** Time or category column. */
  x: string
  /** The centre line: a median, a forecast. */
  y: string
  /** Lower and upper edge of the band: p25/p75, a confidence interval. */
  low: string
  high: string
  /** An optional outer band, drawn lighter: p5/p95. */
  low2?: string
  high2?: string
  format?: Format
}

const num = (v: unknown) => {
  const n = Number(v)
  return v === null || v === undefined || !Number.isFinite(n) ? null : n
}

function Band({ run, props }: { run: QueryRun; props: BandChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { rows } = run.result
  const points = rows.map((row) => ({
    x: row[props.x],
    y: num(row[props.y]),
    low: num(row[props.low]),
    high: num(row[props.high]),
    low2: props.low2 ? num(row[props.low2]) : null,
    high2: props.high2 ? num(row[props.high2]) : null,
  }))
  if (points.every((p) => p.y === null)) {
    return (
      <div className="odd-panel-message">{t('A band chart needs x, y, low and high columns.')}</div>
    )
  }
  const values = points
    .flatMap((p) => [p.y, p.low, p.high, p.low2, p.high2])
    .filter((v): v is number => v !== null)
  const domain = niceDomain(values, 5, false)
  const tick = tickFormatter(domain.ticks, props.format, ctx)
  const margin = {
    top: 8,
    right: 12,
    bottom: 24,
    left: Math.max(...domain.ticks.map((v) => textWidth(tick(v)) + 10), 28),
  }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const n = points.length
  const cx = (i: number) => margin.left + (n === 1 ? w / 2 : (i / (n - 1)) * w)
  const cy = linear([domain.min, domain.max], [margin.top + h, margin.top])
  const area = (lowKey: 'low' | 'low2', highKey: 'high' | 'high2') => {
    const top: string[] = []
    const bottom: string[] = []
    points.forEach((p, i) => {
      const lo = p[lowKey]
      const hi = p[highKey]
      if (lo === null || hi === null) return
      top.push(`${cx(i).toFixed(1)},${cy(hi).toFixed(1)}`)
      bottom.unshift(`${cx(i).toFixed(1)},${cy(lo).toFixed(1)}`)
    })
    return top.length ? `M${top.join('L')}L${bottom.join('L')}Z` : ''
  }
  const line = points
    .map((p, i) => (p.y === null ? null : `${cx(i).toFixed(1)},${cy(p.y).toFixed(1)}`))
    .filter(Boolean)
    .map((xy, i) => `${i ? 'L' : 'M'}${xy}`)
    .join('')
  const labels = points.map((p) => formatCategory(p.x, ctx, 12))
  const shown = thinIndices(n, Math.max(2, Math.floor(w / 72)))
  const active = hover === null ? undefined : points[hover]
  const outer = props.low2 && props.high2

  return (
    <div className="odd-chart">
      <ul className="odd-legend">
        <li>
          <span className="odd-key odd-key-line" style={{ background: POSITIVE }} />
          {humanize(props.y)}
        </li>
        <li>
          <span className="odd-key odd-key-box odd-band-key" />
          {`${humanize(props.low)} – ${humanize(props.high)}`}
        </li>
        {outer ? (
          <li>
            <span className="odd-key odd-key-box odd-band-key-outer" />
            {`${humanize(props.low2 as string)} – ${humanize(props.high2 as string)}`}
          </li>
        ) : null}
      </ul>
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${humanize(props.y)}`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const px = event.clientX - box.left - margin.left
              setHover(
                Math.max(
                  0,
                  Math.min(n - 1, Math.round(n === 1 ? 0 : (px / Math.max(1, w)) * (n - 1))),
                ),
              )
            }}
            onPointerLeave={() => setHover(null)}
          >
            {domain.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={margin.left}
                  x2={margin.left + w}
                  y1={cy(v)}
                  y2={cy(v)}
                  className="odd-grid-line"
                />
                <text
                  x={margin.left - 6}
                  y={cy(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="odd-tick"
                >
                  {tick(v)}
                </text>
              </g>
            ))}
            {outer ? <path d={area('low2', 'high2')} className="odd-band-outer" /> : null}
            <path d={area('low', 'high')} className="odd-band" />
            <path d={line} stroke={POSITIVE} className="odd-line" />
            {shown.map((i) => (
              <text
                key={i}
                x={cx(i)}
                y={margin.top + h + 16}
                textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}
                className="odd-tick"
              >
                {labels[i]}
              </text>
            ))}
            {hover !== null ? (
              <>
                <line
                  x1={cx(hover)}
                  x2={cx(hover)}
                  y1={margin.top}
                  y2={margin.top + h}
                  className="odd-crosshair"
                />
                {active?.y !== null && active?.y !== undefined ? (
                  <circle
                    cx={cx(hover)}
                    cy={cy(active.y)}
                    r={4}
                    fill={POSITIVE}
                    className="odd-dot"
                  />
                ) : null}
              </>
            ) : null}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={cx(hover)}
            top={8}
            width={size.width}
            title={formatValue(active.x, undefined, ctx)}
            rows={[
              {
                color: POSITIVE,
                label: humanize(props.y),
                value: formatValue(active.y, props.format, ctx),
              },
              {
                label: `${humanize(props.low)} – ${humanize(props.high)}`,
                value: `${formatValue(active.low, props.format, ctx)} – ${formatValue(active.high, props.format, ctx)}`,
              },
              ...(outer
                ? [
                    {
                      label: `${humanize(props.low2 as string)} – ${humanize(props.high2 as string)}`,
                      value: `${formatValue(active.low2, props.format, ctx)} – ${formatValue(active.high2, props.format, ctx)}`,
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** A line with its spread: percentile bands, a forecast with its interval. */
function BandChartPanel(props: BandChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="BandChart" state={state} defaultHeight={300}>
      {(run) => <Band run={run} props={props} />}
    </PanelFrame>
  )
}

export const BandChart = editable('BandChart', BandChartPanel)
