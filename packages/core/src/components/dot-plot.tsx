import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import { humanize, MAX_SERIES, pickX } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { fitLabels, rowBands, textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface DotPlotProps extends PanelProps {
  query: string
  /** One row per value of this column. Default: the first text column. */
  label?: string
  /** One or more measures, one dot colour each. Default: every numeric column. */
  value?: string | string[]
  format?: Format
  /** Start the axis at zero. Default false — the point of a dot plot is a tight range. */
  zero?: boolean
}

function Dots({ run, props }: { run: QueryRun; props: DotPlotProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { columns, rows } = run.result
  const label = pickX(columns, props.label)
  const numeric = columns.filter((c) => c.type === 'number' && c.name !== label).map((c) => c.name)
  const measures = (
    props.value === undefined ? numeric : Array.isArray(props.value) ? props.value : [props.value]
  ).slice(0, MAX_SERIES)
  if (!label || measures.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('Needs a label column and a numeric value column.')}
      </div>
    )
  }

  const values = rows.flatMap((row) => measures.map((m) => Number(row[m]))).filter(Number.isFinite)
  const domain = niceDomain(values, 5, Boolean(props.zero))
  const tick = tickFormatter(domain.ticks, props.format, ctx)
  const room = Math.min(size.width * 0.34, 200)
  const labels = fitLabels(
    rows.map((row) => row[label]),
    ctx,
    room,
  )
  const left = Math.min(room, Math.max(24, ...labels.map(textWidth))) + 10
  const right = 16
  const bands = rowBands(rows.length, size.height, 4, 24)
  const sx = linear([domain.min, domain.max], [left, Math.max(left, size.width - right)])
  const active = hover === null ? undefined : rows[hover]

  return (
    <div className="odd-chart">
      {measures.length > 1 ? (
        <ul className="odd-legend">
          {measures.map((m, i) => (
            <li key={m}>
              <span className="odd-key odd-key-dot" style={{ background: seriesColor(i) }} />
              {humanize(m)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${measures.map(humanize).join(', ')} by ${humanize(label)}`}
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
              const dots = measures.map((m) => Number(row[m])).filter(Number.isFinite)
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
                  {dots.length > 1 ? (
                    <line
                      x1={sx(Math.min(...dots))}
                      x2={sx(Math.max(...dots))}
                      y1={y}
                      y2={y}
                      className="odd-connector"
                    />
                  ) : null}
                  {measures.map((m, k) => {
                    const v = Number(row[m])
                    return Number.isFinite(v) ? (
                      <circle
                        key={m}
                        cx={sx(v)}
                        cy={y}
                        r={5}
                        fill={seriesColor(k)}
                        className="odd-dot"
                      />
                    ) : null
                  })}
                </g>
              )
            })}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={sx(
              Math.max(
                ...measures.map((m) => Number(active[m])).filter(Number.isFinite),
                domain.min,
              ),
            )}
            top={Math.max(0, bands.center(hover) - 34)}
            width={size.width}
            title={formatValue(active[label], undefined, ctx)}
            rows={measures.map((m, k) => ({
              color: seriesColor(k),
              label: humanize(m),
              value: formatValue(active[m], props.format, ctx),
            }))}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Precise comparison across many categories, on an axis that need not start at zero. */
function DotPlotPanel(props: DotPlotProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="DotPlot" state={state} defaultHeight={320}>
      {(run) => <Dots run={run} props={props} />}
    </PanelFrame>
  )
}

export const DotPlot = editable('DotPlot', DotPlotPanel)
