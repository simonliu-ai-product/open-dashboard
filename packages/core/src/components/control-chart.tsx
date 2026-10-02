import { useState } from 'react'
import { POSITIVE } from '../runtime/color.js'
import { formatCategory, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain, thinIndices } from '../runtime/scale.js'
import { humanize } from '../runtime/shape.js'
import { controlLimits } from '../runtime/timeseries.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface ControlChartProps extends PanelProps {
  query: string
  /** Time or sequence column. */
  x: string
  /** The measured value. */
  y: string
  /** Columns holding the centre line and control limits; without them, mean ± 3σ of the data. */
  center?: string
  upper?: string
  lower?: string
  format?: Format
}

const num = (v: unknown) => {
  const n = Number(v)
  return v === null || v === undefined || !Number.isFinite(n) ? null : n
}

function Control({ run, props }: { run: QueryRun; props: ControlChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { rows } = run.result
  const ys = rows.map((row) => num(row[props.y]))
  if (ys.every((v) => v === null)) {
    return (
      <div className="odd-panel-message">
        {t('A control chart needs x and a numeric y column.')}
      </div>
    )
  }
  const computed = controlLimits(ys.filter((v): v is number => v !== null))
  const limit = (column: string | undefined, fallback: number) =>
    rows.map((row) => (column ? (num(row[column]) ?? fallback) : fallback))
  const center = limit(props.center, computed.center)
  const upper = limit(props.upper, computed.upper)
  const lower = limit(props.lower, computed.lower)
  const outside = ys.map(
    (v, i) => v !== null && (v > (upper[i] as number) || v < (lower[i] as number)),
  )
  const domain = niceDomain(
    [...ys.filter((v): v is number => v !== null), ...upper, ...lower],
    5,
    false,
  )
  const tick = tickFormatter(domain.ticks, props.format, ctx)
  const margin = {
    top: 8,
    right: 40,
    bottom: 24,
    left: Math.max(...domain.ticks.map((v) => textWidth(tick(v)) + 10), 28),
  }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const n = rows.length
  const cx = (i: number) => margin.left + (n === 1 ? w / 2 : (i / (n - 1)) * w)
  const cy = linear([domain.min, domain.max], [margin.top + h, margin.top])
  const path = (values: (number | null)[]) =>
    values
      .map((v, i) => (v === null ? null : `${cx(i).toFixed(1)},${cy(v).toFixed(1)}`))
      .filter(Boolean)
      .map((xy, i) => `${i ? 'L' : 'M'}${xy}`)
      .join('')
  const labels = rows.map((row) => formatCategory(row[props.x], ctx, 12))
  const shown = thinIndices(n, Math.max(2, Math.floor(w / 72)))

  return (
    <div className="odd-chart">
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
            {(
              [
                ['UCL', upper],
                ['CL', center],
                ['LCL', lower],
              ] as const
            ).map(([name, values]) => (
              <g key={name}>
                <path
                  d={path(values)}
                  className={name === 'CL' ? 'odd-control-center' : 'odd-control-limit'}
                />
                <text
                  x={margin.left + w + 4}
                  y={cy(values[n - 1] as number)}
                  dy="0.32em"
                  className="odd-tick"
                >
                  {name}
                </text>
              </g>
            ))}
            <path d={path(ys)} stroke={POSITIVE} className="odd-line" />
            {ys.map((v, i) =>
              v !== null && outside[i] ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: points are positional
                <circle key={i} cx={cx(i)} cy={cy(v)} r={5} className="odd-control-out" />
              ) : null,
            )}
            {shown.map((i) => (
              <text
                key={`x${i}`}
                x={cx(i)}
                y={margin.top + h + 16}
                textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}
                className="odd-tick"
              >
                {labels[i]}
              </text>
            ))}
            {hover !== null && ys[hover] !== null ? (
              <>
                <line
                  x1={cx(hover)}
                  x2={cx(hover)}
                  y1={margin.top}
                  y2={margin.top + h}
                  className="odd-crosshair"
                />
                <circle
                  cx={cx(hover)}
                  cy={cy(ys[hover] as number)}
                  r={4}
                  fill={POSITIVE}
                  className="odd-dot"
                />
              </>
            ) : null}
          </svg>
        ) : null}
        {hover !== null ? (
          <ChartTooltip
            left={cx(hover)}
            top={8}
            width={size.width}
            title={formatValue(rows[hover]?.[props.x], undefined, ctx)}
            rows={[
              {
                color: POSITIVE,
                label: humanize(props.y),
                value: formatValue(ys[hover], props.format, ctx),
              },
              { label: 'UCL', value: formatValue(upper[hover], props.format, ctx) },
              { label: 'CL', value: formatValue(center[hover], props.format, ctx) },
              { label: 'LCL', value: formatValue(lower[hover], props.format, ctx) },
              ...(outside[hover]
                ? [{ color: 'var(--odd-critical)', label: t('Outside control limits'), value: '▲' }]
                : []),
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Is this movement noise or a signal? A run against its centre line and ±3σ limits. */
function ControlChartPanel(props: ControlChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="ControlChart" state={state} defaultHeight={300}>
      {(run) => <Control run={run} props={props} />}
    </PanelFrame>
  )
}

export const ControlChart = editable('ControlChart', ControlChartPanel)
