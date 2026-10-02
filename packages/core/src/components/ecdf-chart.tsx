import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { ecdf, numbers, quantile } from '../runtime/distribution.js'
import { formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { SampleNote } from './histogram.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { edgeRoom, thinTicks } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface EcdfChartProps extends PanelProps {
  query: string
  /** Raw numeric column, one row per observation. */
  value: string
  /** A column splitting the rows into up to eight groups, one line each. */
  series?: string
  /** Percentiles to mark, as fractions: `[0.5, 0.9]`. */
  marks?: number[]
  format?: Format
}

interface Line {
  name: string
  sorted: number[]
  steps: { value: number; share: number }[]
}

function shareAtOrBelow(sorted: number[], x: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((sorted[mid] as number) <= x) lo = mid + 1
    else hi = mid
  }
  return sorted.length ? lo / sorted.length : 0
}

function Curves({ run, props }: { run: QueryRun; props: EcdfChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hoverX, setHoverX] = useState<number | null>(null)
  const groups = new Map<string, unknown[]>()
  for (const row of run.result.rows) {
    const name = props.series ? String(row[props.series] ?? '—') : ''
    if (!groups.has(name) && groups.size >= 8) continue
    const list = groups.get(name) ?? []
    list.push(row[props.value])
    groups.set(name, list)
  }
  const lines: Line[] = [...groups].map(([name, list]) => {
    const sorted = numbers(list)
    return { name, sorted, steps: ecdf(sorted) }
  })
  const all = lines.flatMap((l) => l.sorted)
  if (all.length === 0)
    return <div className="odd-panel-message">{t('Needs a numeric value column.')}</div>

  const xd = niceDomain(all, 5, false)
  const xTick = tickFormatter(xd.ticks, props.format, ctx)
  const yTicks = [0, 0.25, 0.5, 0.75, 1]
  const margin = { top: 8, right: edgeRoom(xd.ticks, xTick), bottom: 24, left: 44 }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const sx = linear([xd.min, xd.max], [margin.left, margin.left + w])
  const sy = linear([0, 1], [margin.top + h, margin.top])
  const path = (line: Line) => {
    let d = `M${sx(xd.min)},${sy(0)}`
    let prev = 0
    for (const step of line.steps) {
      d += `L${sx(step.value)},${sy(prev)}L${sx(step.value)},${sy(step.share)}`
      prev = step.share
    }
    return `${d}L${sx(xd.max)},${sy(1)}`
  }
  const valueAt =
    hoverX === null ? undefined : xd.min + ((hoverX - margin.left) / (w || 1)) * (xd.max - xd.min)

  return (
    <div className="odd-chart">
      {lines.length > 1 ? (
        <ul className="odd-legend">
          {lines.map((line, i) => (
            <li key={line.name}>
              <span className="odd-key odd-key-line" style={{ background: seriesColor(i) }} />
              {line.name}
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
            aria-label={`${props.title}: ${t('share of rows at or below each value')}`}
            onPointerMove={(event) => {
              const x = event.clientX - event.currentTarget.getBoundingClientRect().left
              setHoverX(x >= margin.left && x <= margin.left + w ? x : null)
            }}
            onPointerLeave={() => setHoverX(null)}
          >
            {yTicks.map((v) => (
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
                  {formatValue(v, 'percent', ctx)}
                </text>
              </g>
            ))}
            {thinTicks(xd.ticks, xTick, w).map((v) => (
              <text
                key={v}
                x={sx(v)}
                y={margin.top + h + 16}
                textAnchor="middle"
                className="odd-tick"
              >
                {xTick(v)}
              </text>
            ))}
            {(props.marks ?? []).map((p) => (
              <g key={p}>
                <line
                  x1={margin.left}
                  x2={margin.left + w}
                  y1={sy(p)}
                  y2={sy(p)}
                  className="odd-reference"
                />
                <text
                  x={margin.left + w}
                  y={sy(p) - 4}
                  textAnchor="end"
                  className="odd-reference-label"
                >
                  {`p${Math.round(p * 100)} ${lines.length === 1 ? formatValue(quantile(lines[0]?.sorted ?? [], p), props.format, ctx) : ''}`.trim()}
                </text>
              </g>
            ))}
            {lines.map((line, i) => (
              <path key={line.name} d={path(line)} stroke={seriesColor(i)} className="odd-line" />
            ))}
            {hoverX !== null ? (
              <line
                x1={hoverX}
                x2={hoverX}
                y1={margin.top}
                y2={margin.top + h}
                className="odd-crosshair"
              />
            ) : null}
          </svg>
        ) : null}
        {valueAt !== undefined && hoverX !== null ? (
          <ChartTooltip
            left={hoverX}
            top={margin.top + 8}
            width={size.width}
            title={t('At or below {value}', { value: formatValue(valueAt, props.format, ctx) })}
            rows={lines.map((line, i) => ({
              color: seriesColor(i),
              label: line.name || t('Rows'),
              value: formatValue(shareAtOrBelow(line.sorted, valueAt), 'percent', ctx),
            }))}
          />
        ) : null}
      </div>
      <SampleNote run={run} />
    </div>
  )
}

/** What share of rows fall at or below any value — "90% of orders ship within N days". */
function EcdfChartPanel(props: EcdfChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="EcdfChart" state={state} defaultHeight={300}>
      {(run) => <Curves run={run} props={props} />}
    </PanelFrame>
  )
}

export const EcdfChart = editable('EcdfChart', EcdfChartPanel)
