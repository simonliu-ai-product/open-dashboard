import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { histogram, numbers } from '../runtime/distribution.js'
import { formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { edgeRoom, textWidth, thinTicks } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface HistogramProps extends PanelProps {
  query: string
  /** Raw numeric column, one row per observation. */
  value?: string
  /** Pre-binned alternative: the bin's lower edge (or name) … */
  bin?: string
  /** … and how many fall in it. */
  count?: string
  /** Number of bins for raw values. Default: Freedman–Diaconis, 5–60. */
  bins?: number
  format?: Format
}

interface Bar {
  label: string
  from: number | null
  to: number | null
  count: number
}

export function SampleNote({ run }: { run: QueryRun }) {
  const t = useT()
  if (!run.result.truncated) return null
  return (
    <p className="odd-sample-note">
      {t('Distribution of the first {n} rows only, a sample.', {
        n: run.result.rows.length.toLocaleString(),
      })}
    </p>
  )
}

function Bins({ run, props }: { run: QueryRun; props: HistogramProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { rows } = run.result

  let bars: Bar[]
  if (props.bin && props.count) {
    const bin = props.bin
    const count = props.count
    bars = rows.map((row) => {
      const edge = Number(row[bin])
      return {
        label: String(row[bin] ?? '—'),
        from: Number.isFinite(edge) ? edge : null,
        to: null,
        count: Number(row[count]) || 0,
      }
    })
  } else if (props.value) {
    const value = props.value
    const values = numbers(rows.map((row) => row[value]))
    bars = histogram(values, props.bins).map((b) => ({
      label: '',
      from: b.from,
      to: b.to,
      count: b.count,
    }))
  } else {
    return (
      <div className="odd-panel-message">
        {t('Needs a numeric value column, or bin and count columns.')}
      </div>
    )
  }
  if (bars.length === 0)
    return <div className="odd-panel-message">{t('No numeric values to plot.')}</div>

  const total = bars.reduce((n, b) => n + b.count, 0)
  const yd = niceDomain(
    bars.map((b) => b.count),
    4,
    true,
  )
  const yTick = tickFormatter(yd.ticks, 'integer', ctx)
  const numeric = bars.every((b) => b.from !== null && b.to !== null)
  const xTicks = numeric
    ? niceDomain([bars[0]?.from as number, bars[bars.length - 1]?.to as number], 5, false).ticks
    : []
  const xTick = tickFormatter(xTicks, props.format, ctx)
  const margin = {
    top: 8,
    right: numeric ? edgeRoom(xTicks, xTick, 12) : 12,
    bottom: 26,
    left: Math.max(...yd.ticks.map((v) => textWidth(yTick(v)) + 10), 24),
  }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const sy = linear([yd.min, yd.max], [margin.top + h, margin.top])
  const band = w / bars.length
  const sx = numeric
    ? linear(
        [bars[0]?.from as number, bars[bars.length - 1]?.to as number],
        [margin.left, margin.left + w],
      )
    : undefined
  const range = (b: Bar) =>
    b.from !== null && b.to !== null
      ? `${formatValue(b.from, props.format, ctx)} – ${formatValue(b.to, props.format, ctx)}`
      : b.label
  const active = hover === null ? undefined : bars[hover]

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('histogram of {column}', { column: humanize(props.value ?? props.bin ?? '') })}`}
          >
            {yd.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={margin.left}
                  x2={margin.left + w}
                  y1={sy(v)}
                  y2={sy(v)}
                  className={v === 0 ? 'odd-baseline' : 'odd-grid-line'}
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
            {bars.map((b, i) => {
              const x0 = sx && b.from !== null ? sx(b.from) : margin.left + band * i
              const x1 = sx && b.to !== null ? sx(b.to) : margin.left + band * (i + 1)
              const top = sy(b.count)
              return (
                <g
                  // biome-ignore lint/suspicious/noArrayIndexKey: bins are positional
                  key={i}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                >
                  <rect
                    x={x0}
                    y={margin.top}
                    width={Math.max(0, x1 - x0)}
                    height={h}
                    fill="transparent"
                  />
                  <rect
                    x={x0 + 1}
                    y={top}
                    width={Math.max(0, x1 - x0 - 2)}
                    height={Math.max(0, sy(0) - top)}
                    rx={Math.min(2, (x1 - x0) / 4)}
                    fill={seriesColor(0)}
                    className="odd-bar"
                    data-dim={hover !== null && hover !== i ? '' : undefined}
                  />
                </g>
              )
            })}
            {numeric && sx
              ? thinTicks(xTicks, xTick, w).map((v) => (
                  <text
                    key={v}
                    x={sx(v)}
                    y={margin.top + h + 16}
                    textAnchor="middle"
                    className="odd-tick"
                  >
                    {xTick(v)}
                  </text>
                ))
              : bars.map((b, i) =>
                  bars.length <= 16 || i % Math.ceil(bars.length / 16) === 0 ? (
                    <text
                      // biome-ignore lint/suspicious/noArrayIndexKey: bins are positional
                      key={i}
                      x={margin.left + band * (i + 0.5)}
                      y={margin.top + h + 16}
                      textAnchor="middle"
                      className="odd-tick"
                    >
                      {b.label}
                    </text>
                  ) : null,
                )}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={margin.left + band * (hover + 0.5)}
            top={Math.max(0, sy(active.count) - 40)}
            width={size.width}
            title={range(active)}
            rows={[
              { label: t('Count'), value: formatValue(active.count, 'integer', ctx) },
              {
                label: t('Share'),
                value: formatValue(total ? active.count / total : 0, 'percent', ctx),
              },
            ]}
          />
        ) : null}
      </div>
      <SampleNote run={run} />
    </div>
  )
}

/** How one measure is spread: where values cluster, whether there is a long tail or two peaks. */
function HistogramPanel(props: HistogramProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Histogram" state={state} defaultHeight={300}>
      {(run) => <Bins run={run} props={props} />}
    </PanelFrame>
  )
}

export const Histogram = editable('Histogram', HistogramPanel)
