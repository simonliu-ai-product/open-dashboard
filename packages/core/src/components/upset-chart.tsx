import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { upsetData } from '../runtime/upset.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface UpSetChartProps extends PanelProps {
  query: string
  /** The combination, as a comma-separated list of set names: 'Beans,Grinders'. */
  sets: string
  /** How many have exactly that combination. */
  value: string
  /** Intersections shown, largest first. Default 15. */
  top?: number
  format?: Format
}

/**
 * Overlaps between many sets, which a Venn diagram cannot draw past three:
 * a bar per exact combination, a dot matrix naming its members, and each
 * set's total at the left.
 */
function Matrix({ run, props }: { run: QueryRun; props: UpSetChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { sets, intersections, hidden } = upsetData(
    run.result.rows,
    { sets: props.sets, value: props.value },
    props.top ?? 15,
  )
  if (intersections.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('Needs a sets column (comma-separated names) and a positive value column.')}
      </div>
    )
  }

  const total = intersections.reduce((s, i) => s + i.value, 0)
  const nameWidth = Math.min(160, Math.max(...sets.map((s) => textWidth(s.name)), 40) + 12)
  const totalsWidth = Math.min(90, Math.max(48, size.width * 0.12))
  const left = totalsWidth + nameWidth
  const rowH = Math.max(14, Math.min(22, (size.height * 0.45) / Math.max(1, sets.length)))
  const matrixH = rowH * sets.length
  const barsTop = 8
  const barsH = Math.max(40, size.height - matrixH - barsTop - 14)
  const matrixTop = barsTop + barsH + 10
  const w = Math.max(0, size.width - left - 8)
  const band = w / intersections.length
  const yd = niceDomain(
    intersections.map((i) => i.value),
    3,
    true,
  )
  const yTick = tickFormatter(yd.ticks, props.format, ctx)
  const sy = linear([yd.min, yd.max], [barsTop + barsH, barsTop])
  const setMax = Math.max(...sets.map((s) => s.total), 1)
  const bar = Math.min(24, band * 0.7)
  const cx = (i: number) => left + band * (i + 0.5)
  const cy = (s: number) => matrixTop + rowH * (s + 0.5)
  const active = hover === null ? undefined : intersections[hover]

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('overlaps between sets')}`}
          >
            {yd.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={left}
                  x2={left + w}
                  y1={sy(v)}
                  y2={sy(v)}
                  className={v === 0 ? 'odd-baseline' : 'odd-grid-line'}
                />
                <text x={left - 6} y={sy(v)} dy="0.32em" textAnchor="end" className="odd-tick">
                  {yTick(v)}
                </text>
              </g>
            ))}
            {sets.map((s, k) => (
              <g key={s.name}>
                {k % 2 === 0 ? (
                  <rect
                    x={left}
                    y={cy(k) - rowH / 2}
                    width={w}
                    height={rowH}
                    className="odd-upset-stripe"
                  />
                ) : null}
                <rect
                  x={totalsWidth - 4 - ((totalsWidth - 8) * s.total) / setMax}
                  y={cy(k) - Math.min(8, rowH / 2 - 2)}
                  width={((totalsWidth - 8) * s.total) / setMax}
                  height={Math.min(16, rowH - 4)}
                  rx={2}
                  className="odd-upset-total"
                />
                <text
                  x={totalsWidth + 4}
                  y={cy(k)}
                  dy="0.35em"
                  className="odd-tick odd-tick-category"
                >
                  {s.name}
                </text>
              </g>
            ))}
            {intersections.map((inter, i) => {
              const members = inter.sets
                .map((name) => sets.findIndex((s) => s.name === name))
                .filter((k) => k >= 0)
              const top = Math.min(...members)
              const bottom = Math.max(...members)
              return (
                <g
                  key={inter.sets.join(',')}
                  data-dim={hover !== null && hover !== i ? '' : undefined}
                  className="odd-upset-column"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                >
                  <rect
                    x={left + band * i}
                    y={barsTop}
                    width={band}
                    height={matrixTop + matrixH - barsTop}
                    fill="transparent"
                  />
                  <path
                    d={`M${cx(i) - bar / 2},${sy(0)}V${sy(inter.value) + 3}Q${cx(i) - bar / 2},${sy(inter.value)} ${cx(i) - bar / 2 + 3},${sy(inter.value)}H${cx(i) + bar / 2 - 3}Q${cx(i) + bar / 2},${sy(inter.value)} ${cx(i) + bar / 2},${sy(inter.value) + 3}V${sy(0)}Z`}
                    fill={seriesColor(0)}
                    className="odd-bar"
                  />
                  {members.length > 1 ? (
                    <line
                      x1={cx(i)}
                      x2={cx(i)}
                      y1={cy(top)}
                      y2={cy(bottom)}
                      className="odd-upset-link"
                    />
                  ) : null}
                  {sets.map((s, k) => (
                    <circle
                      key={s.name}
                      cx={cx(i)}
                      cy={cy(k)}
                      r={Math.min(5, rowH / 3)}
                      className={members.includes(k) ? 'odd-upset-on' : 'odd-upset-off'}
                    />
                  ))}
                </g>
              )
            })}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={cx(hover)}
            top={Math.max(0, sy(active.value) - 40)}
            width={size.width}
            title={active.sets.join(' + ')}
            rows={[
              { label: t('Value'), value: formatValue(active.value, props.format, ctx) },
              {
                label: t('Share'),
                value: formatValue(active.value / (total || 1), 'percent', ctx),
              },
            ]}
          />
        ) : null}
      </div>
      {hidden > 0 ? (
        <p className="odd-sample-note">{t('{n} smaller combinations not shown.', { n: hidden })}</p>
      ) : null}
    </div>
  )
}

/** Which combinations occur and how often — what is bought together, which features are used together. */
function UpSetChartPanel(props: UpSetChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="UpSetChart" state={state} defaultHeight={360}>
      {(run) => <Matrix run={run} props={props} />}
    </PanelFrame>
  )
}

export const UpSetChart = editable('UpSetChart', UpSetChartPanel)
