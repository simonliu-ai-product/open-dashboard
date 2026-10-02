import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { bumpRanks } from '../runtime/comparison.js'
import { formatCategory, formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { thinIndices } from '../runtime/scale.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface BumpChartProps extends PanelProps {
  query: string
  /** The periods, in order — order the rows in SQL. */
  x: string
  /** The entities being ranked: products, regions, reps. */
  series: string
  /** What they are ranked by. Highest is rank 1 unless `ascending`. */
  value: string
  /** Rank lowest first (fastest time, fewest complaints). */
  ascending?: boolean
  /** Only entities that reach this rank at least once are drawn. Default 8. */
  top?: number
  format?: Format
}

function Bumps({ run, props }: { run: QueryRun; props: BumpChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const [point, setPoint] = useState<{ name: string; i: number } | null>(null)
  const names = new Set(run.result.columns.map((c) => c.name))
  if (!names.has(props.x) || !names.has(props.series) || !names.has(props.value)) {
    return (
      <div className="odd-panel-message">{t('Needs x, series and a numeric value column.')}</div>
    )
  }
  const data = bumpRanks(run.result.rows, props.x, props.series, props.value, {
    ...(props.ascending !== undefined ? { ascending: props.ascending } : {}),
    ...(props.top !== undefined ? { top: props.top } : {}),
  })
  if (data.entities.length === 0)
    return <div className="odd-panel-message">{t('No rows for these filters')}</div>

  const n = data.categories.length
  const endLabels = data.entities.map((e) => e.name)
  const left = 28
  const right = Math.min(size.width * 0.3, Math.max(...endLabels.map(textWidth), 30) + 14)
  const top = 12
  const bottom = 26
  const w = Math.max(0, size.width - left - right)
  const h = Math.max(0, size.height - top - bottom)
  const sx = (i: number) => left + (n === 1 ? w / 2 : (i / (n - 1)) * w)
  const sy = (rank: number) =>
    top + (data.maxRank === 1 ? h / 2 : ((rank - 1) / (data.maxRank - 1)) * h)
  const categoryLabels = data.categories.map((c) => formatCategory(c, ctx, 10))
  const shown = thinIndices(n, Math.max(2, Math.floor(w / 64)))
  const active = point ? data.entities.find((e) => e.name === point.name) : undefined

  return (
    <div className="odd-plot" ref={ref}>
      {size.width > 0 ? (
        <svg
          width={size.width}
          height={size.height}
          role="img"
          aria-label={`${props.title}: rank of ${humanize(props.series)} by ${humanize(props.value)}`}
        >
          {Array.from({ length: data.maxRank }, (_, k) => k + 1).map((rank) => (
            <g key={rank}>
              <line x1={left} x2={left + w} y1={sy(rank)} y2={sy(rank)} className="odd-grid-line" />
              <text x={left - 8} y={sy(rank)} dy="0.32em" textAnchor="end" className="odd-tick">
                {rank}
              </text>
            </g>
          ))}
          {shown.map((i) => (
            <text
              key={i}
              x={sx(i)}
              y={top + h + 18}
              textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}
              className="odd-tick"
            >
              {categoryLabels[i]}
            </text>
          ))}
          {data.entities.map((entity, k) => {
            const color = seriesColor(k)
            const dim =
              (hover !== null && hover !== entity.name) ||
              (drill?.anyActive && !drill.isActive(entity.name))
            const segments: string[] = []
            let current = ''
            entity.ranks.forEach((rank, i) => {
              if (rank === null) {
                if (current) segments.push(current)
                current = ''
                return
              }
              current += `${current ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(rank).toFixed(1)}`
            })
            if (current) segments.push(current)
            let last = -1
            for (let i = entity.ranks.length - 1; i >= 0; i -= 1) {
              if (entity.ranks[i] !== null) {
                last = i
                break
              }
            }
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
              <g
                key={entity.name}
                className={drill ? 'odd-slope odd-drillable' : 'odd-slope'}
                data-dim={dim ? '' : undefined}
                data-active={hover === entity.name || undefined}
                onPointerEnter={() => setHover(entity.name)}
                onPointerLeave={() => {
                  setHover(null)
                  setPoint(null)
                }}
                onClick={drill ? () => drill.pick(entity.name) : undefined}
              >
                {segments.map((d) => (
                  <g key={d}>
                    <path d={d} stroke="transparent" strokeWidth={12} fill="none" />
                    <path d={d} stroke={color} className="odd-line" />
                  </g>
                ))}
                {entity.ranks.map((rank, i) =>
                  rank === null ? null : (
                    <circle
                      // biome-ignore lint/suspicious/noArrayIndexKey: points are positional and rebuilt every render
                      key={i}
                      cx={sx(i)}
                      cy={sy(rank)}
                      r={4}
                      fill={color}
                      className="odd-dot"
                      onPointerEnter={() => setPoint({ name: entity.name, i })}
                    />
                  ),
                )}
                {last >= 0 ? (
                  <text
                    x={sx(last) + 10}
                    y={sy(entity.ranks[last] as number)}
                    dy="0.35em"
                    className="odd-value-label"
                  >
                    {entity.name}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
      ) : null}
      {active && point ? (
        <ChartTooltip
          left={sx(point.i)}
          top={Math.max(0, sy(active.ranks[point.i] ?? 1) - 40)}
          width={size.width}
          title={`${active.name}, ${formatValue(data.categories[point.i], undefined, ctx)}`}
          rows={[
            {
              color: seriesColor(data.entities.indexOf(active)),
              label: t('Rank'),
              value: String(active.ranks[point.i] ?? '—'),
            },
            {
              label: humanize(props.value),
              value: formatValue(active.values[point.i] ?? null, props.format, ctx),
            },
          ]}
        />
      ) : null}
    </div>
  )
}

/** Who led when: rank over time, so a climb from fifth to first is a line you can follow. */
function BumpChartPanel(props: BumpChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="BumpChart" state={state} defaultHeight={340}>
      {(run) => <Bumps run={run} props={props} />}
    </PanelFrame>
  )
}

export const BumpChart = editable('BumpChart', BumpChartPanel)
