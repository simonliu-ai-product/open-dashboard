import { useState } from 'react'
import { formatShort, formatValue } from '../runtime/format.js'
import { pickX, pickY } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'

export interface PieChartProps extends PanelProps {
  query: string
  /** The slice names. Default: the first non-numeric column. */
  label?: string
  /** The slice sizes. Default: the first numeric column. */
  value?: string
  format?: Format
  /** Past this many slices the smallest are summed into "Other". Default 6. */
  maxSlices?: number
}

const MAX = 6

function arc(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0
  const p = (radius: number, angle: number) =>
    `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    return `M${p(r, 0)}A${r},${r} 0 1 1 ${p(r, Math.PI)}A${r},${r} 0 1 1 ${p(r, 0)}ZM${p(inner, 0)}A${inner},${inner} 0 1 0 ${p(inner, Math.PI)}A${inner},${inner} 0 1 0 ${p(inner, 0)}Z`
  }
  return `M${p(r, a0)}A${r},${r} 0 ${large} 1 ${p(r, a1)}L${p(inner, a1)}A${inner},${inner} 0 ${large} 0 ${p(inner, a0)}Z`
}

function Donut({ run, props }: { run: QueryRun; props: PieChartProps }) {
  const ctx = useFormatContext()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { columns, rows } = run.result
  const label = pickX(columns, props.label)
  const value = pickY(columns, label, props.value)[0]
  if (!label || !value)
    return <div className="odd-panel-message">Needs a label column and a numeric value column.</div>

  const limit = Math.max(2, props.maxSlices ?? MAX)
  let slices = rows
    .map((row) => ({ label: String(row[label] ?? '—'), value: Number(row[value]) }))
    .filter((s) => Number.isFinite(s.value) && s.value > 0)
    .sort((a, b) => b.value - a.value)
  if (slices.length > limit) {
    const rest = slices.slice(limit - 1).reduce((sum, s) => sum + s.value, 0)
    slices = [...slices.slice(0, limit - 1), { label: 'Other', value: rest }]
  }
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  if (total <= 0)
    return (
      <div className="odd-panel-message">Nothing to show — every value is zero or negative.</div>
    )

  const narrow = size.width < 440
  const d = Math.min(size.width * (narrow ? 0.42 : 0.4), size.height, 240)
  const r = Math.max(0, d / 2 - 4)
  const inner = r * 0.62
  const centerText = formatValue(
    hover !== null ? slices[hover]?.value : total,
    props.format === 'percent' ? undefined : (props.format ?? 'compact'),
    ctx,
  )
  const centerSize = Math.max(
    10,
    Math.min(18, (inner * 1.7) / Math.max(1, centerText.length * 0.6)),
  )
  const cx = r + 4
  const cy = size.height / 2
  let angle = 0
  const active = hover !== null ? slices[hover] : undefined

  return (
    <div className="odd-donut" ref={ref}>
      {size.width > 0 && r > 0 ? (
        <svg
          width={d}
          height={size.height}
          role="img"
          aria-label={`${props.title}: share by ${label}`}
        >
          {slices.map((slice, i) => {
            const a0 = angle
            angle += (slice.value / total) * Math.PI * 2
            return (
              <path
                key={slice.label}
                d={arc(cx, cy, r, inner, a0, angle)}
                fill={`var(--odd-series-${i + 1})`}
                className="odd-slice"
                data-dim={hover !== null && hover !== i ? '' : undefined}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            )
          })}
          <text
            x={cx}
            y={cy - 4}
            textAnchor="middle"
            className="odd-donut-total"
            style={{ fontSize: centerSize }}
          >
            {centerText}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="odd-donut-caption">
            {active ? active.label : 'Total'}
          </text>
        </svg>
      ) : null}
      <ul className="odd-donut-legend" data-narrow={narrow || undefined}>
        {slices.map((slice, i) => (
          <li
            key={slice.label}
            data-active={hover === i || undefined}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <span
              className="odd-key odd-key-box"
              style={{ background: `var(--odd-series-${i + 1})` }}
            />
            <span className="odd-donut-label">{slice.label}</span>
            {narrow ? null : (
              <span className="odd-donut-value">{formatShort(slice.value, props.format, ctx)}</span>
            )}
            <span className="odd-donut-share">
              {formatValue(slice.value / total, 'percent', ctx)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Part of a whole, at a glance. Six slices at most; for close values use a BarChart. */
export function PieChart(props: PieChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="PieChart" state={state} defaultHeight={300}>
      {(run) => <Donut run={run} props={props} />}
    </PanelFrame>
  )
}
