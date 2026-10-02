import { useState } from 'react'
import { NEGATIVE, NEUTRAL, POSITIVE } from '../runtime/color.js'
import { declutter, toNumber } from '../runtime/comparison.js'
import { formatShort, formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import { humanize, pickX } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { fitLabels, textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface SlopeChartProps extends PanelProps {
  query: string
  /** One line per value of this column. Default: the first text column. */
  label?: string
  /** The left-hand value: the earlier period. */
  from: string
  /** The right-hand value: the later period. */
  to: string
  format?: Format
  /** Headings over the two sides. Default: the column names. */
  labels?: { from?: string; to?: string }
  /** Start the axis at zero. Default false. */
  zero?: boolean
}

function Slopes({ run, props }: { run: QueryRun; props: SlopeChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { columns, rows } = run.result
  const label = pickX(columns, props.label)
  const names = new Set(columns.map((c) => c.name))
  if (!label || !names.has(props.from) || !names.has(props.to)) {
    return (
      <div className="odd-panel-message">
        {t('Needs a label column and numeric from and to columns.')}
      </div>
    )
  }

  const items = rows
    .map((row) => ({ name: row[label], a: toNumber(row[props.from]), b: toNumber(row[props.to]) }))
    .filter(
      (i): i is { name: unknown; a: number; b: number } => i.a !== undefined && i.b !== undefined,
    )
  const domain = niceDomain(
    items.flatMap((i) => [i.a, i.b]),
    5,
    Boolean(props.zero),
  )
  const top = 30
  const bottom = 10
  const sy = linear([domain.min, domain.max], [Math.max(top, size.height - bottom), top])
  const room = Math.min(size.width * 0.3, 180)
  const names_ = fitLabels(
    items.map((i) => i.name),
    ctx,
    room,
  )
  const leftText = items.map((item, i) => `${names_[i]}  ${formatShort(item.a, props.format, ctx)}`)
  const rightText = items.map(
    (item, i) => `${formatShort(item.b, props.format, ctx)}  ${names_[i]}`,
  )
  const x0 = Math.min(size.width * 0.38, Math.max(...leftText.map(textWidth), 40) + 12)
  const x1 = Math.max(
    x0 + 40,
    size.width - Math.min(size.width * 0.38, Math.max(...rightText.map(textWidth), 40) + 12),
  )
  const leftY = declutter(
    items.map((i) => sy(i.a)),
    14,
    top,
    size.height - bottom,
  )
  const rightY = declutter(
    items.map((i) => sy(i.b)),
    14,
    top,
    size.height - bottom,
  )
  const colorOf = (item: { a: number; b: number }) =>
    item.b > item.a ? POSITIVE : item.b < item.a ? NEGATIVE : NEUTRAL
  const fromName = props.labels?.from ?? humanize(props.from)
  const toName = props.labels?.to ?? humanize(props.to)
  const active = hover === null ? undefined : items[hover]

  return (
    <div className="odd-chart">
      <ul className="odd-legend">
        <li>
          <span className="odd-key odd-key-line" style={{ background: POSITIVE }} />
          {t('Rose')}
        </li>
        <li>
          <span className="odd-key odd-key-line" style={{ background: NEGATIVE }} />
          {t('Fell')}
        </li>
      </ul>
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${fromName} to ${toName} by ${humanize(label)}`}
          >
            <text x={x0} y={14} textAnchor="middle" className="odd-tick odd-tick-category">
              {fromName}
            </text>
            <text x={x1} y={14} textAnchor="middle" className="odd-tick odd-tick-category">
              {toName}
            </text>
            <line x1={x0} x2={x0} y1={top - 6} y2={size.height - bottom} className="odd-baseline" />
            <line x1={x1} x2={x1} y1={top - 6} y2={size.height - bottom} className="odd-baseline" />
            {items.map((item, i) => {
              const dim =
                (hover !== null && hover !== i) || (drill?.anyActive && !drill.isActive(item.name))
              const color = colorOf(item)
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                <g
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional and rebuilt every render
                  key={i}
                  className={drill ? 'odd-slope odd-drillable' : 'odd-slope'}
                  data-dim={dim ? '' : undefined}
                  data-active={hover === i || undefined}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onClick={drill ? () => drill.pick(item.name) : undefined}
                >
                  <line
                    x1={x0}
                    x2={x1}
                    y1={sy(item.a)}
                    y2={sy(item.b)}
                    stroke="transparent"
                    strokeWidth={12}
                  />
                  <line
                    x1={x0}
                    x2={x1}
                    y1={sy(item.a)}
                    y2={sy(item.b)}
                    stroke={color}
                    className="odd-line"
                  />
                  <circle cx={x0} cy={sy(item.a)} r={4} fill={color} className="odd-dot" />
                  <circle cx={x1} cy={sy(item.b)} r={4} fill={color} className="odd-dot" />
                  <text
                    x={x0 - 10}
                    y={leftY[i]}
                    dy="0.35em"
                    textAnchor="end"
                    className="odd-value-label"
                  >
                    {leftText[i]}
                  </text>
                  <text x={x1 + 10} y={rightY[i]} dy="0.35em" className="odd-value-label">
                    {rightText[i]}
                  </text>
                </g>
              )
            })}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={(x0 + x1) / 2}
            top={Math.max(0, (sy(active.a) + sy(active.b)) / 2 - 40)}
            width={size.width}
            title={formatValue(active.name, undefined, ctx)}
            rows={[
              { label: fromName, value: formatValue(active.a, props.format, ctx) },
              { label: toName, value: formatValue(active.b, props.format, ctx) },
              {
                color: colorOf(active),
                label: t('Change'),
                value: active.a
                  ? formatValue((active.b - active.a) / Math.abs(active.a), 'percent', ctx)
                  : '—',
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Who rose and who fell between two points in time — every category, one line each. */
function SlopeChartPanel(props: SlopeChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="SlopeChart" state={state} defaultHeight={340}>
      {(run) => <Slopes run={run} props={props} />}
    </PanelFrame>
  )
}

export const SlopeChart = editable('SlopeChart', SlopeChartPanel)
