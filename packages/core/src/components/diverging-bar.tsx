import { useState } from 'react'
import { NEGATIVE, POSITIVE } from '../runtime/color.js'
import { toNumber } from '../runtime/comparison.js'
import { formatShort, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import { humanize, pickX, pickY } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { fitLabels, rowBands, textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface DivergingBarProps extends PanelProps {
  query: string
  /** One bar per value of this column. Default: the first text column. */
  label?: string
  /** A signed measure: variance, growth, net change. Default: the first numeric column. */
  value?: string
  format?: Format
  /** Below zero is good (costs under budget, fewer complaints): swaps the two colours. */
  invert?: boolean
}

/** A bar from x0 to x1 (either order) with a 4px rounded end away from zero. */
function bar(x0: number, x1: number, y: number, h: number): string {
  const left = Math.min(x0, x1)
  const w = Math.abs(x1 - x0)
  const r = Math.max(0, Math.min(4, w / 2, h / 2))
  if (r === 0) return `M${left},${y}h${w}v${h}h${-w}Z`
  if (x1 >= x0) {
    return `M${left},${y}H${left + w - r}Q${left + w},${y} ${left + w},${y + r}V${y + h - r}Q${left + w},${y + h} ${left + w - r},${y + h}H${left}Z`
  }
  return `M${left + w},${y}H${left + r}Q${left},${y} ${left},${y + r}V${y + h - r}Q${left},${y + h} ${left + r},${y + h}H${left + w}Z`
}

function Bars({ run, props }: { run: QueryRun; props: DivergingBarProps }) {
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

  const good = props.invert ? NEGATIVE : POSITIVE
  const bad = props.invert ? POSITIVE : NEGATIVE
  const values = rows.map((row) => toNumber(row[value]))
  const finite = values.filter((v): v is number => v !== undefined)
  const extent = Math.max(1e-9, ...finite.map(Math.abs))
  const domain = niceDomain([-extent, extent], 4, true)
  const tick = tickFormatter(domain.ticks, props.format, ctx)
  const tips = values.map((v) =>
    v === undefined ? '' : `${v > 0 ? '+' : ''}${formatShort(v, props.format, ctx)}`,
  )
  const room = Math.min(size.width * 0.28, 170)
  const labels = fitLabels(
    rows.map((row) => row[label]),
    ctx,
    room,
  )
  const left = Math.min(room, Math.max(24, ...labels.map(textWidth))) + 10
  const pad = Math.max(...tips.map(textWidth), 24) + 6
  const bands = rowBands(rows.length, size.height, 4, 24)
  const sx = linear([domain.min, domain.max], [left + pad, Math.max(left + pad, size.width - pad)])
  const zero = sx(0)
  const thickness = Math.max(3, Math.min(24, bands.band * 0.62))
  const active = hover === null ? undefined : rows[hover]

  return (
    <div className="odd-plot" ref={ref}>
      {size.width > 0 ? (
        <svg
          width={size.width}
          height={size.height}
          role="img"
          aria-label={`${props.title}: ${humanize(value)} by ${humanize(label)}`}
        >
          {domain.ticks.map((v) => (
            <g key={v}>
              <line
                x1={sx(v)}
                x2={sx(v)}
                y1={bands.top}
                y2={bands.bottom}
                className={v === 0 ? 'odd-baseline' : 'odd-grid-line'}
              />
              <text x={sx(v)} y={bands.bottom + 16} textAnchor="middle" className="odd-tick">
                {tick(v)}
              </text>
            </g>
          ))}
          {rows.map((row, i) => {
            const v = values[i]
            const y = bands.center(i)
            const dim =
              (hover !== null && hover !== i) || (drill?.anyActive && !drill.isActive(row[label]))
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
              <g
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and rebuilt every render
                key={i}
                className={drill ? 'odd-row-mark odd-drillable' : 'odd-row-mark'}
                data-dim={dim ? '' : undefined}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onClick={drill ? () => drill.pick(row[label]) : undefined}
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
                {v !== undefined && v !== 0 ? (
                  <>
                    <path
                      d={bar(zero, sx(v), y - thickness / 2, thickness)}
                      fill={v > 0 ? good : bad}
                    />
                    <text
                      x={sx(v) + (v > 0 ? 6 : -6)}
                      y={y}
                      dy="0.35em"
                      textAnchor={v > 0 ? 'start' : 'end'}
                      className="odd-value-label"
                    >
                      {tips[i]}
                    </text>
                  </>
                ) : null}
              </g>
            )
          })}
        </svg>
      ) : null}
      {active && hover !== null ? (
        <ChartTooltip
          left={sx(values[hover] ?? 0)}
          top={Math.max(0, bands.center(hover) - 34)}
          width={size.width}
          title={formatValue(active[label], undefined, ctx)}
          rows={[
            {
              color: (values[hover] ?? 0) >= 0 ? good : bad,
              label: humanize(value),
              value: formatValue(active[value], props.format, ctx),
            },
          ]}
        />
      ) : null}
    </div>
  )
}

/** Above or below zero — variance against budget, growth and decline — side by side. */
function DivergingBarPanel(props: DivergingBarProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="DivergingBar" state={state} defaultHeight={320}>
      {(run) => <Bars run={run} props={props} />}
    </PanelFrame>
  )
}

export const DivergingBar = editable('DivergingBar', DivergingBarPanel)
