import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { concentration, shareAt } from '../runtime/distribution.js'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear } from '../runtime/scale.js'
import { pickX, pickY } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { ChartTooltip } from './tooltip.js'

export interface ParetoChartProps extends PanelProps {
  query: string
  /** The entity column (customer, product). Default: the first text column. */
  label?: string
  /** What each holds (revenue, orders). Default: the first numeric column. */
  value?: string
  /** The share of entities to call out, 0–1. Default 0.2: "the top 20%". */
  at?: number
  format?: Format
}

const TICKS = [0, 0.25, 0.5, 0.75, 1]

/**
 * A concentration curve on one percent scale: across, the share of entities
 * taken largest first; up, the share of the total they hold. The diagonal is
 * an even spread. One axis — the classic bars-plus-cumulative-line Pareto
 * needs two, and this says the same thing without them.
 */
function Curve({ run, props }: { run: QueryRun; props: ParetoChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { columns, rows } = run.result
  const label = pickX(columns, props.label)
  const value = pickY(columns, label, props.value)[0]
  if (!label || !value)
    return (
      <div className="odd-panel-message">
        {t('Needs a label column and a numeric value column.')}
      </div>
    )
  const steps = concentration(
    rows.map((row) => ({ label: String(row[label] ?? '—'), value: Number(row[value]) })),
  )
  if (steps.length === 0)
    return (
      <div className="odd-panel-message">
        {t('Nothing to show: every value is zero or negative.')}
      </div>
    )

  const at = Math.max(0.01, Math.min(0.99, props.at ?? 0.2))
  const held = shareAt(steps, at)
  const margin = { top: 10, right: 16, bottom: 26, left: 44 }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const sx = linear([0, 1], [margin.left, margin.left + w])
  const sy = linear([0, 1], [margin.top + h, margin.top])
  const line = [
    `M${sx(0)},${sy(0)}`,
    ...steps.map((s) => `L${sx(s.entities)},${sy(s.share)}`),
  ].join('')
  const area = `${line}L${sx(1)},${sy(0)}Z`
  const active = hover === null ? undefined : steps[hover]
  const pct = (n: number) => formatValue(n, 'percent', ctx)

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('Top {top} hold {share}', { top: pct(at), share: pct(held) })}`}
            onPointerMove={(event) => {
              const x = event.clientX - event.currentTarget.getBoundingClientRect().left
              const f = (x - margin.left) / (w || 1)
              if (f < 0 || f > 1) return setHover(null)
              const index = steps.findIndex((s) => s.entities >= f)
              setHover(index === -1 ? steps.length - 1 : index)
            }}
            onPointerLeave={() => setHover(null)}
          >
            {TICKS.map((v) => (
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
                  {pct(v)}
                </text>
                <text
                  x={sx(v)}
                  y={margin.top + h + 16}
                  textAnchor={v === 0 ? 'start' : v === 1 ? 'end' : 'middle'}
                  className="odd-tick"
                >
                  {pct(v)}
                </text>
              </g>
            ))}
            <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} className="odd-reference" />
            <path d={area} fill={seriesColor(0)} className="odd-area" />
            <path d={line} stroke={seriesColor(0)} className="odd-line" />
            <line x1={sx(at)} x2={sx(at)} y1={sy(0)} y2={sy(held)} className="odd-reference" />
            <line x1={sx(0)} x2={sx(at)} y1={sy(held)} y2={sy(held)} className="odd-reference" />
            <circle cx={sx(at)} cy={sy(held)} r={4} fill={seriesColor(0)} className="odd-dot" />
            <text x={sx(at) + 8} y={sy(held) + 14} className="odd-callout-label">
              {t('Top {top} hold {share}', { top: pct(at), share: pct(held) })}
            </text>
            {active ? (
              <circle
                cx={sx(active.entities)}
                cy={sy(active.share)}
                r={4}
                fill={seriesColor(0)}
                className="odd-dot"
              />
            ) : null}
          </svg>
        ) : null}
        {active ? (
          <ChartTooltip
            left={sx(active.entities)}
            top={Math.max(0, sy(active.share) - 10)}
            width={size.width}
            title={active.label}
            rows={[
              { label: t('Value'), value: formatValue(active.value, props.format, ctx) },
              { label: t('Top share of entities'), value: pct(active.entities) },
              { label: t('Cumulative share'), value: pct(active.share) },
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** How concentrated a total is: what share the biggest few hold. */
function ParetoChartPanel(props: ParetoChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="ParetoChart" state={state} defaultHeight={300}>
      {(run) => <Curve run={run} props={props} />}
    </PanelFrame>
  )
}

export const ParetoChart = editable('ParetoChart', ParetoChartPanel)
