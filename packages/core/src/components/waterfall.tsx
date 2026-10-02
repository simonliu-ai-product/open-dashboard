import { useState } from 'react'
import { NEGATIVE, NEUTRAL, POSITIVE } from '../runtime/color.js'
import { formatCategory, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import { pickX, pickY } from '../runtime/shape.js'
import { waterfallSteps } from '../runtime/timeseries.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface WaterfallProps extends PanelProps {
  query: string
  /** Step names, in order. Default: the first text column. */
  label?: string
  /** Signed change of each step. Default: the first numeric column. */
  value?: string
  /** A column marking total rows: rows whose value is 'total' are drawn from zero. */
  type?: string
  /** Label of the closing total appended when there is no `type` column. */
  total?: string
  format?: Format
}

const KIND_COLOR = { up: POSITIVE, down: NEGATIVE, total: NEUTRAL }

function Bridge({ run, props }: { run: QueryRun; props: WaterfallProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { columns, rows } = run.result
  const label = pickX(columns, props.label)
  const value = pickY(columns, label, props.value)[0]
  if (!label || !value) {
    return (
      <div className="odd-panel-message">
        {t('Needs a label column and a numeric value column.')}
      </div>
    )
  }
  const steps = waterfallSteps(
    rows
      .map((row) => ({
        label: String(row[label] ?? '—'),
        value: Number(row[value]),
        total: props.type ? String(row[props.type] ?? '').toLowerCase() === 'total' : false,
      }))
      .filter((r) => Number.isFinite(r.value)),
    props.type ? undefined : (props.total ?? t('Total')),
  )
  const domain = niceDomain(
    steps.flatMap((s) => [s.from, s.to]),
    5,
    true,
  )
  const tick = tickFormatter(domain.ticks, props.format, ctx)
  const margin = {
    top: 8,
    right: 12,
    bottom: 26,
    left: Math.max(...domain.ticks.map((v) => textWidth(tick(v)) + 10), 28),
  }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const band = w / Math.max(1, steps.length)
  const thickness = Math.max(2, Math.min(24, band * 0.6))
  const y = linear([domain.min, domain.max], [margin.top + h, margin.top])
  const fit = Math.max(1, Math.floor(w / 64))
  const every = Math.max(1, Math.ceil(steps.length / fit))
  const active = hover === null ? undefined : steps[hover]

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('waterfall')}`}
          >
            {domain.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={margin.left}
                  x2={margin.left + w}
                  y1={y(v)}
                  y2={y(v)}
                  className={v === 0 ? 'odd-baseline' : 'odd-grid-line'}
                />
                <text
                  x={margin.left - 6}
                  y={y(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="odd-tick"
                >
                  {tick(v)}
                </text>
              </g>
            ))}
            {steps.map((step, i) => {
              const cx = margin.left + band * (i + 0.5)
              const top = y(Math.max(step.from, step.to))
              const bottom = y(Math.min(step.from, step.to))
              const next = steps[i + 1]
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                <g
                  // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
                  key={i}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onClick={
                    drill && step.kind !== 'total' ? () => drill.pick(step.label) : undefined
                  }
                  className={drill && step.kind !== 'total' ? 'odd-drillable' : undefined}
                  data-dim={hover !== null && hover !== i ? '' : undefined}
                >
                  <rect
                    x={margin.left + band * i}
                    y={margin.top}
                    width={band}
                    height={h}
                    fill="transparent"
                  />
                  <rect
                    x={cx - thickness / 2}
                    y={top}
                    width={thickness}
                    height={Math.max(1, bottom - top)}
                    rx={Math.min(4, thickness / 4)}
                    fill={KIND_COLOR[step.kind]}
                    className="odd-bar"
                  />
                  {next ? (
                    <line
                      x1={cx + thickness / 2}
                      x2={margin.left + band * (i + 1.5) - thickness / 2}
                      y1={y(step.to)}
                      y2={y(step.to)}
                      className="odd-waterfall-connector"
                    />
                  ) : null}
                  {i % every === 0 || i === steps.length - 1 ? (
                    <text
                      x={cx}
                      y={margin.top + h + 16}
                      textAnchor="middle"
                      className="odd-tick odd-tick-category"
                    >
                      {formatCategory(step.label, ctx, Math.max(4, Math.floor((band * every) / 7)))}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={margin.left + band * (hover + 0.5)}
            top={Math.max(0, y(Math.max(active.from, active.to)) - 30)}
            width={size.width}
            title={active.label}
            rows={
              active.kind === 'total'
                ? [{ label: t('Total'), value: formatValue(active.to, props.format, ctx) }]
                : [
                    {
                      color: KIND_COLOR[active.kind],
                      label: t('Change'),
                      value: `${active.to >= active.from ? '+' : ''}${formatValue(active.to - active.from, props.format, ctx)}`,
                    },
                    { label: t('Running total'), value: formatValue(active.to, props.format, ctx) },
                  ]
            }
          />
        ) : null}
      </div>
    </div>
  )
}

/** How a total got from one value to another: each step's increase or decrease, in order. */
function WaterfallPanel(props: WaterfallProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Waterfall" state={state} defaultHeight={320}>
      {(run) => <Bridge run={run} props={props} />}
    </PanelFrame>
  )
}

export const Waterfall = editable('Waterfall', WaterfallPanel)
