import { useState } from 'react'
import { NEGATIVE, POSITIVE } from '../runtime/color.js'
import { formatShort, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import { humanize, pickX } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { fitLabels, rowBands, textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface DumbbellProps extends PanelProps {
  query: string
  /** One row per value of this column. Default: the first text column. */
  label?: string
  /** The starting value: last period, the plan. */
  from: string
  /** The value it is compared with: this period, the actual. */
  to: string
  format?: Format
  /** Names for the two ends in the legend. Default: the column names. */
  labels?: { from?: string; to?: string }
  /** Start the axis at zero. Default false. */
  zero?: boolean
}

const FROM_COLOR = 'var(--odd-axis)'
const TO_COLOR = 'var(--odd-series-1)'

function Bells({ run, props }: { run: QueryRun; props: DumbbellProps }) {
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

  const fromName = props.labels?.from ?? humanize(props.from)
  const toName = props.labels?.to ?? humanize(props.to)
  const values = rows
    .flatMap((row) => [Number(row[props.from]), Number(row[props.to])])
    .filter(Number.isFinite)
  const domain = niceDomain(values, 5, Boolean(props.zero))
  const tick = tickFormatter(domain.ticks, props.format, ctx)
  const room = Math.min(size.width * 0.32, 200)
  const labels = fitLabels(
    rows.map((row) => row[label]),
    ctx,
    room,
  )
  const left = Math.min(room, Math.max(24, ...labels.map(textWidth))) + 10
  const deltas = rows.map((row) => {
    const a = Number(row[props.from])
    const b = Number(row[props.to])
    return Number.isFinite(a) && Number.isFinite(b) ? b - a : undefined
  })
  const deltaText = deltas.map((d) =>
    d === undefined ? '' : `${d > 0 ? '+' : ''}${formatShort(d, props.format, ctx)}`,
  )
  const right = Math.max(28, ...deltaText.map(textWidth)) + 12
  const bands = rowBands(rows.length, size.height, 4, 24)
  const sx = linear([domain.min, domain.max], [left, Math.max(left, size.width - right)])
  const active = hover === null ? undefined : rows[hover]

  return (
    <div className="odd-chart">
      <ul className="odd-legend">
        <li>
          <span className="odd-key odd-key-dot" style={{ background: FROM_COLOR }} />
          {fromName}
        </li>
        <li>
          <span className="odd-key odd-key-dot" style={{ background: TO_COLOR }} />
          {toName}
        </li>
      </ul>
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${fromName} → ${toName} by ${humanize(label)}`}
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
              const y = bands.center(i)
              const a = Number(row[props.from])
              const b = Number(row[props.to])
              const d = deltas[i]
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
                  {Number.isFinite(a) && Number.isFinite(b) ? (
                    <line
                      x1={sx(a)}
                      x2={sx(b)}
                      y1={y}
                      y2={y}
                      className="odd-connector odd-connector-strong"
                    />
                  ) : null}
                  {Number.isFinite(a) ? (
                    <circle cx={sx(a)} cy={y} r={5} fill={FROM_COLOR} className="odd-dot" />
                  ) : null}
                  {Number.isFinite(b) ? (
                    <circle cx={sx(b)} cy={y} r={5} fill={TO_COLOR} className="odd-dot" />
                  ) : null}
                  {d !== undefined ? (
                    <g>
                      <circle
                        cx={size.width - right + 8}
                        cy={y}
                        r={2.5}
                        fill={d >= 0 ? POSITIVE : NEGATIVE}
                      />
                      <text
                        x={size.width - right + 14}
                        y={y}
                        dy="0.35em"
                        className="odd-value-label"
                      >
                        {deltaText[i]}
                      </text>
                    </g>
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={sx(Number(active[props.to]) || domain.min)}
            top={Math.max(0, bands.center(hover) - 34)}
            width={size.width}
            title={formatValue(active[label], undefined, ctx)}
            rows={[
              {
                color: FROM_COLOR,
                label: fromName,
                value: formatValue(active[props.from], props.format, ctx),
              },
              {
                color: TO_COLOR,
                label: toName,
                value: formatValue(active[props.to], props.format, ctx),
              },
              {
                label: t('Change'),
                value: deltas[hover] === undefined ? '—' : (deltaText[hover] as string),
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** How far each category moved between two values — before and after, plan and actual. */
function DumbbellPanel(props: DumbbellProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Dumbbell" state={state} defaultHeight={320}>
      {(run) => <Bells run={run} props={props} />}
    </PanelFrame>
  )
}

export const Dumbbell = editable('Dumbbell', DumbbellPanel)
