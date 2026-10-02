import { useState } from 'react'
import { sequential } from '../runtime/color.js'
import { formatCategory, formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { thinIndices } from '../runtime/scale.js'
import { horizonFill } from '../runtime/timeseries.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface HorizonChartProps extends PanelProps {
  query: string
  /** Time column, shared by every row. */
  x: string
  /** One row per value of this column: a host, a service, a store. */
  series: string
  /** The measure (non-negative). */
  y: string
  /** How many bands each row folds into. Default 3. */
  bands?: number
  format?: Format
}

const ROW = 32

/**
 * Many series in little height: each row is folded into bands of rising
 * intensity, so a value three bands high reads as the darkest colour rather
 * than a taller line.
 */
function Horizon({ run, props }: { run: QueryRun; props: HorizonChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const bands = Math.max(1, Math.min(5, props.bands ?? 3))
  const categories: unknown[] = []
  const position = new Map<string, number>()
  const series = new Map<string, (number | null)[]>()
  for (const row of run.result.rows) {
    const key = String(row[props.x])
    if (!position.has(key)) {
      position.set(key, categories.length)
      categories.push(row[props.x])
    }
  }
  for (const row of run.result.rows) {
    const name = String(row[props.series] ?? '—')
    if (!series.has(name))
      series.set(
        name,
        categories.map(() => null),
      )
    const n = Number(row[props.y])
    if (Number.isFinite(n))
      (series.get(name) as (number | null)[])[position.get(String(row[props.x])) as number] = n
  }
  if (series.size === 0 || categories.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('A horizon chart needs x, y and a series column.')}
      </div>
    )
  }
  const max = Math.max(...[...series.values()].flat().filter((v): v is number => v !== null), 1e-9)
  const names = [...series.keys()]
  const left = Math.min(160, Math.max(...names.map((s) => textWidth(s)), 40) + 12)
  const w = Math.max(0, size.width - left - 8)
  const n = categories.length
  const step = w / Math.max(1, n)
  const height = names.length * (ROW + 2) + 22
  const widest = Math.max(...categories.map((c) => textWidth(formatCategory(c, ctx, 12))), 40)
  const shown = thinIndices(n, Math.max(2, Math.floor(w / (widest + 16))))

  return (
    <div className="odd-chart">
      <div className="odd-plot odd-horizon" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={height}
            role="img"
            aria-label={`${props.title}: ${props.y} by ${props.series}`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const i = Math.floor((event.clientX - box.left - left) / Math.max(1, step))
              setHover(i >= 0 && i < n ? i : null)
            }}
            onPointerLeave={() => setHover(null)}
          >
            {names.map((name, r) => {
              const values = series.get(name) as (number | null)[]
              const top = r * (ROW + 2)
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the filter's own <select> is the keyboard path
                <g
                  key={name}
                  onClick={drill ? () => drill.pick(name) : undefined}
                  className={drill ? 'odd-drillable' : undefined}
                  data-dim={drill?.anyActive && !drill.isActive(name) ? '' : undefined}
                >
                  <text
                    x={left - 8}
                    y={top + ROW / 2}
                    dy="0.35em"
                    textAnchor="end"
                    className="odd-tick odd-tick-category"
                  >
                    {name.length > 22 ? `${name.slice(0, 21)}…` : name}
                  </text>
                  <rect x={left} y={top} width={w} height={ROW} fill="var(--odd-surface-2)" />
                  {Array.from({ length: bands }, (_, band) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: bands are positional
                    <g key={band}>
                      {values.map((v, i) => {
                        const fill = v === null ? 0 : (horizonFill(v, max, bands)[band] as number)
                        if (fill <= 0) return null
                        const barHeight = fill * ROW
                        return (
                          <rect
                            // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
                            key={i}
                            x={left + step * i}
                            y={top + ROW - barHeight}
                            width={Math.max(0.5, step + 0.4)}
                            height={barHeight}
                            fill={sequential((band + 1) / bands)}
                          />
                        )
                      })}
                    </g>
                  ))}
                </g>
              )
            })}
            {shown.map((i) => (
              <text
                key={i}
                x={left + step * (i + 0.5)}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                className="odd-tick"
              >
                {formatCategory(categories[i], ctx, 12)}
              </text>
            ))}
            {hover !== null ? (
              <line
                x1={left + step * (hover + 0.5)}
                x2={left + step * (hover + 0.5)}
                y1={0}
                y2={height - 20}
                className="odd-crosshair"
              />
            ) : null}
          </svg>
        ) : null}
        {hover !== null ? (
          <ChartTooltip
            left={left + step * (hover + 0.5)}
            top={4}
            width={size.width}
            title={formatValue(categories[hover], undefined, ctx)}
            rows={names.slice(0, 12).map((name) => ({
              label: name,
              value: formatValue(
                (series.get(name) as (number | null)[])[hover] ?? null,
                props.format,
                ctx,
              ),
            }))}
          />
        ) : null}
      </div>
      <div className="odd-scale" aria-hidden="true">
        <span>
          {t('Each band is {size}', { size: formatValue(max / bands, props.format, ctx) })}
        </span>
        <span
          className="odd-scale-bar"
          style={{
            background: `linear-gradient(to right, ${Array.from({ length: bands }, (_, b) => `${sequential((b + 1) / bands)} ${(b / bands) * 100}% ${((b + 1) / bands) * 100}%`).join(', ')})`,
          }}
        />
      </div>
    </div>
  )
}

/** Dozens of series in a small height — servers, stores, products — scanned for the one that spikes. */
function HorizonChartPanel(props: HorizonChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="HorizonChart" state={state} defaultHeight={320}>
      {(run) => <Horizon run={run} props={props} />}
    </PanelFrame>
  )
}

export const HorizonChart = editable('HorizonChart', HorizonChartPanel)
