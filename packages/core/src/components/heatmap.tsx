import { useState } from 'react'
import { sequential as shade } from '../runtime/color.js'
import { formatCategory, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface HeatmapProps extends PanelProps {
  query: string
  /** The column whose values run across. */
  x: string
  /** The column whose values run down. */
  y: string
  /** The numeric column that colours each cell. */
  value: string
  format?: Format
}

function Grid({ run, props }: { run: QueryRun; props: HeatmapProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null)
  const { rows } = run.result
  const xs: unknown[] = []
  const ys: unknown[] = []
  const cells = new Map<string, number>()
  for (const row of rows) {
    const x = row[props.x]
    const y = row[props.y]
    if (!xs.some((v) => String(v) === String(x))) xs.push(x)
    if (!ys.some((v) => String(v) === String(y))) ys.push(y)
    const n = Number(row[props.value])
    if (Number.isFinite(n))
      cells.set(
        `${String(x)}\u0000${String(y)}`,
        (cells.get(`${String(x)}\u0000${String(y)}`) ?? 0) + n,
      )
  }
  // Rows come ordered by y, then x, so a column missing from the first row
  // would otherwise be appended at the end. Columns that read as numbers,
  // times or dates are put in their natural order instead.
  if (xs.every((v) => typeof v === 'number' || /^\d/.test(String(v)))) {
    xs.sort((a, b) =>
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), 'en', { numeric: true }),
    )
  }
  if (xs.length === 0 || ys.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('A heatmap needs x, y and a numeric value column.')}
      </div>
    )
  }
  const values = [...cells.values()]
  const min = Math.min(0, ...values)
  const max = Math.max(...values, 1e-9)
  const yLabels = ys.map((v) => formatCategory(v, ctx, 14))
  const xLabels = xs.map((v) => formatCategory(v, ctx, 10))
  const left = Math.max(...yLabels.map((l) => textWidth(l)), 20) + 10
  const top = 4
  const bottom = 40
  const w = Math.max(0, size.width - left - 4)
  const h = Math.max(0, size.height - top - bottom)
  const cw = w / xs.length
  const ch = h / ys.length
  const every = Math.max(
    1,
    Math.ceil((xLabels.reduce((m, l) => Math.max(m, l.length), 0) * 6.8 + 8) / Math.max(cw, 1)),
  )
  const active = hover
    ? {
        x: xs[hover.i],
        y: ys[hover.j],
        v: cells.get(`${String(xs[hover.i])}\u0000${String(ys[hover.j])}`),
      }
    : undefined

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${humanize(props.value)} by ${humanize(props.x)} and ${humanize(props.y)}`}
          >
            {ys.map((y, j) => (
              <text
                key={`y${String(y)}`}
                x={left - 8}
                y={top + ch * (j + 0.5)}
                dy="0.35em"
                textAnchor="end"
                className="odd-tick odd-tick-category"
              >
                {yLabels[j]}
              </text>
            ))}
            {xs.map((x, i) =>
              i % every === 0 ? (
                <text
                  key={`x${String(x)}`}
                  x={left + cw * (i + 0.5)}
                  y={top + h + 15}
                  textAnchor="middle"
                  className="odd-tick"
                >
                  {xLabels[i]}
                </text>
              ) : null,
            )}
            {ys.map((y, j) =>
              xs.map((x, i) => {
                const v = cells.get(`${String(x)}\u0000${String(y)}`)
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the table view and filters are the keyboard path
                  <rect
                    key={`${String(x)}|${String(y)}`}
                    x={left + cw * i + 1}
                    y={top + ch * j + 1}
                    width={Math.max(0, cw - 2)}
                    height={Math.max(0, ch - 2)}
                    rx={Math.min(3, cw / 4, ch / 4)}
                    fill={
                      v === undefined ? 'var(--odd-hover)' : shade((v - min) / (max - min || 1))
                    }
                    className={drill ? 'odd-cell odd-drillable' : 'odd-cell'}
                    data-dim={hover && (hover.i !== i || hover.j !== j) ? '' : undefined}
                    onPointerEnter={() => setHover({ i, j })}
                    onPointerLeave={() => setHover(null)}
                    onClick={drill ? () => drill.pick(x) : undefined}
                  />
                )
              }),
            )}
          </svg>
        ) : null}
        {active && hover ? (
          <ChartTooltip
            left={left + cw * (hover.i + 0.5)}
            top={Math.max(0, top + ch * hover.j - 36)}
            width={size.width}
            title={`${formatValue(active.y, undefined, ctx)}, ${formatValue(active.x, undefined, ctx)}`}
            rows={[
              {
                label: humanize(props.value),
                value: formatValue(active.v ?? null, props.format, ctx),
              },
            ]}
          />
        ) : null}
      </div>
      <div className="odd-scale" aria-hidden="true">
        <span>{tickFormatter([min, max], props.format, ctx)(min)}</span>
        <span
          className="odd-scale-bar"
          style={{
            background: `linear-gradient(to right, ${shade(0)}, ${shade(0.5)}, ${shade(1)})`,
          }}
        />
        <span>{tickFormatter([min, max], props.format, ctx)(max)}</span>
      </div>
    </div>
  )
}

/** Intensity across two categories — weekday by hour, region by month. */
function HeatmapPanel(props: HeatmapProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Heatmap" state={state} defaultHeight={320}>
      {(run) => <Grid run={run} props={props} />}
    </PanelFrame>
  )
}

export const Heatmap = editable('Heatmap', HeatmapPanel)
