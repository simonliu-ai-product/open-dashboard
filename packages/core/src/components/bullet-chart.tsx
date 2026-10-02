import { useState } from 'react'
import { readRef, toNumber } from '../runtime/comparison.js'
import { formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { niceDomain } from '../runtime/scale.js'
import { humanize, pickX, pickY } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { fitLabels, rowBands, textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface BulletChartProps extends PanelProps {
  query: string
  /** One row per value of this column. Default: the first text column. */
  label?: string
  /** The actual. Default: the first numeric column. */
  value?: string
  /** The goal: a number, or a column in the same row. */
  target?: number | string
  /** The scale's end: a number or a column. Default: the largest value, target or band. */
  max?: number | string
  /** Qualitative thresholds, low to high (numbers or columns): drawn as grey steps behind the bar. */
  bands?: (number | string)[]
  format?: Format
}

const BAND_SHADES = [
  'var(--odd-surface-2)',
  'color-mix(in srgb, var(--odd-axis) 45%, var(--odd-surface))',
  'color-mix(in srgb, var(--odd-axis) 70%, var(--odd-surface))',
]

function Bullets({ run, props }: { run: QueryRun; props: BulletChartProps }) {
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

  const items = rows.map((row) => {
    const actual = toNumber(row[value])
    const target = readRef(row, props.target)
    const thresholds = (props.bands ?? [])
      .map((b) => readRef(row, b))
      .filter((b): b is number => b !== undefined)
    const explicit = readRef(row, props.max)
    const max = explicit ?? Math.max(actual ?? 0, target ?? 0, ...thresholds, 0)
    return { name: row[label], actual, target, thresholds, max }
  })
  const shared = props.max === undefined || typeof props.max === 'number'
  const sharedDomain = niceDomain(
    items.flatMap((i) => [i.max]),
    4,
    true,
  )
  const tick = tickFormatter(sharedDomain.ticks, props.format, ctx)
  const room = Math.min(size.width * 0.3, 180)
  const labels = fitLabels(
    items.map((i) => i.name),
    ctx,
    room,
  )
  const left = Math.min(room, Math.max(24, ...labels.map(textWidth))) + 10
  const right = 16
  const width = Math.max(0, size.width - left - right)
  const bands = rowBands(items.length, size.height, 4, shared ? 24 : 4)
  const thickness = Math.min(24, bands.band * 0.62)
  const barThickness = Math.max(4, thickness * 0.38)
  const scaleOf = (max: number) => (v: number) =>
    left + (Math.max(0, Math.min(v, max)) / (max || 1)) * width
  const active = hover === null ? undefined : items[hover]

  return (
    <div className="odd-plot" ref={ref}>
      {size.width > 0 ? (
        <svg
          width={size.width}
          height={size.height}
          role="img"
          aria-label={`${props.title}: ${humanize(value)} against target by ${humanize(label)}`}
        >
          {shared
            ? sharedDomain.ticks.map((v) => {
                const x = scaleOf(sharedDomain.max)(v)
                return (
                  <g key={v}>
                    <line
                      x1={x}
                      x2={x}
                      y1={bands.top}
                      y2={bands.bottom}
                      className="odd-grid-line"
                    />
                    <text x={x} y={bands.bottom + 16} textAnchor="middle" className="odd-tick">
                      {tick(v)}
                    </text>
                  </g>
                )
              })
            : null}
          {items.map((item, i) => {
            const y = bands.center(i)
            const max = shared ? sharedDomain.max : item.max
            const sx = scaleOf(max)
            const steps = [...item.thresholds].sort((a, b) => a - b)
            const edges = [0, ...steps, max]
            const dim =
              (hover !== null && hover !== i) || (drill?.anyActive && !drill.isActive(item.name))
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
              <g
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and rebuilt every render
                key={i}
                className={drill ? 'odd-row-mark odd-drillable' : 'odd-row-mark'}
                data-dim={dim ? '' : undefined}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onClick={drill ? () => drill.pick(item.name) : undefined}
              >
                <rect
                  x={0}
                  y={y - bands.band / 2}
                  width={size.width}
                  height={bands.band}
                  fill="transparent"
                />
                <text
                  x={left - 10}
                  y={y}
                  dy="0.35em"
                  textAnchor="end"
                  className="odd-tick odd-tick-category"
                >
                  {labels[i]}
                </text>
                {edges.slice(0, -1).map((edge, k) => (
                  <rect
                    key={`b${edge}`}
                    x={sx(edge)}
                    y={y - thickness / 2}
                    width={Math.max(0, sx(edges[k + 1] as number) - sx(edge))}
                    height={thickness}
                    fill={BAND_SHADES[Math.min(k, BAND_SHADES.length - 1)]}
                  />
                ))}
                {item.actual !== undefined ? (
                  <rect
                    x={left}
                    y={y - barThickness / 2}
                    width={Math.max(0, sx(item.actual) - left)}
                    height={barThickness}
                    rx={2}
                    fill="var(--odd-series-1)"
                  />
                ) : null}
                {item.target !== undefined ? (
                  <line
                    x1={sx(item.target)}
                    x2={sx(item.target)}
                    y1={y - thickness / 2 - 2}
                    y2={y + thickness / 2 + 2}
                    className="odd-target-mark"
                  />
                ) : null}
              </g>
            )
          })}
        </svg>
      ) : null}
      {active && hover !== null ? (
        <ChartTooltip
          left={left + width / 2}
          top={Math.max(0, bands.center(hover) - 40)}
          width={size.width}
          title={formatValue(active.name, undefined, ctx)}
          rows={[
            {
              color: 'var(--odd-series-1)',
              label: humanize(value),
              value: formatValue(active.actual ?? null, props.format, ctx),
            },
            ...(active.target !== undefined
              ? [
                  { label: t('Target'), value: formatValue(active.target, props.format, ctx) },
                  ...(active.actual !== undefined && active.target
                    ? [
                        {
                          label: t('Of target'),
                          value: formatValue(active.actual / active.target, 'percent', ctx),
                        },
                      ]
                    : []),
                ]
              : []),
          ]}
        />
      ) : null}
    </div>
  )
}

/** Actuals against their targets, row after row — what a gauge does, ten at a time. */
function BulletChartPanel(props: BulletChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="BulletChart" state={state} defaultHeight={280}>
      {(run) => <Bullets run={run} props={props} />}
    </PanelFrame>
  )
}

export const BulletChart = editable('BulletChart', BulletChartPanel)
