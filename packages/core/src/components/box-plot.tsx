import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { type BoxStats, boxStats, numbers } from '../runtime/distribution.js'
import { formatCategory, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { SampleNote } from './histogram.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { edgeRoom, textWidth, thinTicks } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface BoxPlotProps extends PanelProps {
  query: string
  /** Raw numeric column, one row per observation. */
  value?: string
  /** A category column: one box per value (up to 20). */
  label?: string
  /** Precomputed alternative: column names holding each box's five numbers, one row per box. */
  stats?: { min: string; q1: string; median: string; q3: string; max: string }
  format?: Format
}

interface Box {
  name: string
  stats: BoxStats
}

const MAX_BOXES = 20

function precomputed(
  row: Record<string, unknown>,
  stats: NonNullable<BoxPlotProps['stats']>,
): BoxStats | undefined {
  const n = (key: string) => Number(row[key])
  const s = {
    min: n(stats.min),
    q1: n(stats.q1),
    median: n(stats.median),
    q3: n(stats.q3),
    max: n(stats.max),
  }
  if (!Object.values(s).every(Number.isFinite)) return undefined
  return { n: Number.NaN, ...s, low: s.min, high: s.max, outliers: [] }
}

function Boxes({ run, props }: { run: QueryRun; props: BoxPlotProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { rows } = run.result

  const boxes: Box[] = []
  if (props.stats) {
    const stats = props.stats
    for (const row of rows.slice(0, MAX_BOXES)) {
      const s = precomputed(row, stats)
      if (s) boxes.push({ name: props.label ? String(row[props.label] ?? '—') : '', stats: s })
    }
  } else if (props.value) {
    const value = props.value
    const groups = new Map<string, unknown[]>()
    for (const row of rows) {
      const name = props.label ? String(row[props.label] ?? '—') : ''
      if (!groups.has(name) && groups.size >= MAX_BOXES) continue
      const list = groups.get(name) ?? []
      list.push(row[value])
      groups.set(name, list)
    }
    for (const [name, list] of groups) {
      const s = boxStats(numbers(list))
      if (s) boxes.push({ name, stats: s })
    }
  } else {
    return (
      <div className="odd-panel-message">
        {t('Needs a numeric value column, or stats columns.')}
      </div>
    )
  }
  if (boxes.length === 0)
    return <div className="odd-panel-message">{t('No numeric values to plot.')}</div>

  const extent = boxes.flatMap((b) => [b.stats.min, b.stats.max])
  const xd = niceDomain(extent, 5, false)
  const xTick = tickFormatter(xd.ticks, props.format, ctx)
  const labels = boxes.map((b) => formatCategory(b.name, ctx, 18))
  const left =
    boxes.length > 1 || boxes[0]?.name ? Math.max(...labels.map((l) => textWidth(l)), 24) + 12 : 12
  const margin = { top: 6, right: edgeRoom(xd.ticks, xTick), bottom: 24, left }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const sx = linear([xd.min, xd.max], [margin.left, margin.left + w])
  const band = h / boxes.length
  const thick = Math.min(24, band * 0.55)
  const active = hover === null ? undefined : boxes[hover]
  const v = (n: number) => formatValue(n, props.format, ctx)

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('box plot')}`}
          >
            {thinTicks(xd.ticks, xTick, w).map((tick) => (
              <g key={tick}>
                <line
                  x1={sx(tick)}
                  x2={sx(tick)}
                  y1={margin.top}
                  y2={margin.top + h}
                  className="odd-grid-line"
                />
                <text x={sx(tick)} y={margin.top + h + 16} textAnchor="middle" className="odd-tick">
                  {xTick(tick)}
                </text>
              </g>
            ))}
            {boxes.map((box, i) => {
              const cy = margin.top + band * (i + 0.5)
              const s = box.stats
              const dim =
                (hover !== null && hover !== i) || (drill?.anyActive && !drill.isActive(box.name))
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own select is the keyboard path
                <g
                  key={box.name || i}
                  data-dim={dim ? '' : undefined}
                  className={drill ? 'odd-box odd-drillable' : 'odd-box'}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onClick={drill ? () => drill.pick(box.name) : undefined}
                >
                  <rect
                    x={margin.left}
                    y={cy - band / 2}
                    width={w}
                    height={band}
                    fill="transparent"
                  />
                  {box.name ? (
                    <text
                      x={margin.left - 8}
                      y={cy}
                      dy="0.35em"
                      textAnchor="end"
                      className="odd-tick odd-tick-category"
                    >
                      {labels[i]}
                    </text>
                  ) : null}
                  <line x1={sx(s.low)} x2={sx(s.q1)} y1={cy} y2={cy} className="odd-whisker" />
                  <line x1={sx(s.q3)} x2={sx(s.high)} y1={cy} y2={cy} className="odd-whisker" />
                  <line
                    x1={sx(s.low)}
                    x2={sx(s.low)}
                    y1={cy - thick / 4}
                    y2={cy + thick / 4}
                    className="odd-whisker"
                  />
                  <line
                    x1={sx(s.high)}
                    x2={sx(s.high)}
                    y1={cy - thick / 4}
                    y2={cy + thick / 4}
                    className="odd-whisker"
                  />
                  <rect
                    x={sx(s.q1)}
                    y={cy - thick / 2}
                    width={Math.max(1, sx(s.q3) - sx(s.q1))}
                    height={thick}
                    rx={3}
                    fill={seriesColor(0)}
                    className="odd-box-body"
                  />
                  <line
                    x1={sx(s.median)}
                    x2={sx(s.median)}
                    y1={cy - thick / 2}
                    y2={cy + thick / 2}
                    className="odd-median"
                  />
                  {s.outliers.slice(0, 200).map((o, k) => (
                    <circle
                      // biome-ignore lint/suspicious/noArrayIndexKey: outliers are positional
                      key={k}
                      cx={sx(o)}
                      cy={cy}
                      r={3}
                      fill={seriesColor(0)}
                      className="odd-dot"
                    />
                  ))}
                </g>
              )
            })}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={sx(active.stats.median)}
            top={Math.max(0, margin.top + band * hover - 10)}
            width={size.width}
            title={active.name || props.title}
            rows={[
              ...(Number.isFinite(active.stats.n)
                ? [{ label: t('Rows'), value: formatValue(active.stats.n, 'integer', ctx) }]
                : []),
              { label: t('Min'), value: v(active.stats.min) },
              { label: 'Q1', value: v(active.stats.q1) },
              { label: t('Median'), value: v(active.stats.median) },
              { label: 'Q3', value: v(active.stats.q3) },
              { label: t('Max'), value: v(active.stats.max) },
              ...(active.stats.outliers.length
                ? [
                    {
                      label: t('Outliers'),
                      value: formatValue(active.stats.outliers.length, 'integer', ctx),
                    },
                  ]
                : []),
            ]}
          />
        ) : null}
      </div>
      <SampleNote run={run} />
    </div>
  )
}

/** How a measure is spread in each category: middle half, typical range, outliers. */
function BoxPlotPanel(props: BoxPlotProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="BoxPlot" state={state} defaultHeight={300}>
      {(run) => <Boxes run={run} props={props} />}
    </PanelFrame>
  )
}

export const BoxPlot = editable('BoxPlot', BoxPlotPanel)
