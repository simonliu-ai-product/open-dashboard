import { useState } from 'react'
import { inkOn, seriesColor } from '../runtime/color.js'
import { marimekko } from '../runtime/comparison.js'
import { formatCategory, formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { humanize, MAX_SERIES } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface MarimekkoProps extends PanelProps {
  query: string
  /** The column groups: each column is as wide as its share of the total. */
  x: string
  /** The segments stacked inside each column, as tall as their share of it. */
  series: string
  value: string
  format?: Format
}

function Mekko({ run, props }: { run: QueryRun; props: MarimekkoProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ c: number; s: string } | null>(null)
  const names = new Set(run.result.columns.map((c) => c.name))
  if (!names.has(props.x) || !names.has(props.series) || !names.has(props.value)) {
    return (
      <div className="odd-panel-message">{t('Needs x, series and a numeric value column.')}</div>
    )
  }
  const data = marimekko(run.result.rows, props.x, props.series, props.value)
  if (data.total <= 0)
    return (
      <div className="odd-panel-message">
        {t('Nothing to show: every value is zero or negative.')}
      </div>
    )
  const slot = (name: string) => {
    const i = data.series.indexOf(name)
    return i < MAX_SERIES ? i : -1
  }

  const top = 4
  const bottom = 34
  const left = 4
  const w = Math.max(0, size.width - left - 4)
  const h = Math.max(0, size.height - top - bottom)
  const column = hover ? data.columns[hover.c] : undefined
  const segment = column?.segments.find((s) => s.series === hover?.s)

  return (
    <div className="odd-chart">
      {data.series.length > 1 ? (
        <ul className="odd-legend">
          {data.series.slice(0, MAX_SERIES).map((name, i) => (
            <li key={name}>
              <span className="odd-key odd-key-box" style={{ background: seriesColor(i) }} />
              {name}
            </li>
          ))}
          {data.series.length > MAX_SERIES ? (
            <li>
              <span className="odd-key odd-key-box" style={{ background: seriesColor(-1) }} />
              {t('Other')}
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${humanize(props.value)} by ${humanize(props.x)} and ${humanize(props.series)}`}
          >
            {data.columns.map((col, c) => {
              const x0 = left + col.x0 * w
              const cw = (col.x1 - col.x0) * w
              const name = formatCategory(col.key, ctx, 24)
              const fits = textWidth(name) <= cw - 4
              return (
                <g key={String(col.key)}>
                  {col.segments.map((seg) => {
                    const i = slot(seg.series)
                    const y0 = top + seg.y0 * h
                    const sh = (seg.y1 - seg.y0) * h
                    const dim =
                      (hover !== null && (hover.c !== c || hover.s !== seg.series)) ||
                      (drill?.anyActive && !drill.isActive(col.key))
                    const share = formatValue(seg.share, 'percent', ctx)
                    return (
                      // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                      <g
                        key={seg.series}
                        className={drill ? 'odd-drillable' : undefined}
                        data-dim={dim ? '' : undefined}
                        onPointerEnter={() => setHover({ c, s: seg.series })}
                        onPointerLeave={() => setHover(null)}
                        onClick={drill ? () => drill.pick(col.key) : undefined}
                      >
                        <rect
                          x={x0 + 1}
                          y={y0 + 1}
                          width={Math.max(0, cw - 2)}
                          height={Math.max(0, sh - 2)}
                          rx={3}
                          fill={seriesColor(i)}
                          className="odd-tile"
                        />
                        {cw > textWidth(share) + 8 && sh > 22 ? (
                          <text x={x0 + 7} y={y0 + 16} fill={inkOn(i)} className="odd-tile-value">
                            {share}
                          </text>
                        ) : null}
                      </g>
                    )
                  })}
                  {fits ? (
                    <text
                      x={x0 + cw / 2}
                      y={top + h + 15}
                      textAnchor="middle"
                      className="odd-tick odd-tick-category"
                    >
                      {name}
                    </text>
                  ) : null}
                  {cw > 36 ? (
                    <text x={x0 + cw / 2} y={top + h + 29} textAnchor="middle" className="odd-tick">
                      {formatValue(col.total / data.total, 'percent', ctx)}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : null}
        {hover && column && segment ? (
          <ChartTooltip
            left={left + ((column.x0 + column.x1) / 2) * w}
            top={Math.max(0, top + segment.y0 * h - 20)}
            width={size.width}
            title={`${formatValue(column.key, undefined, ctx)}, ${segment.series}`}
            rows={[
              {
                color: seriesColor(slot(segment.series)),
                label: humanize(props.value),
                value: formatValue(segment.value, props.format, ctx),
              },
              { label: t('Share of column'), value: formatValue(segment.share, 'percent', ctx) },
              {
                label: t('Share of total'),
                value: formatValue(segment.value / data.total, 'percent', ctx),
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Shares within shares: how big each group is, and how it splits — a stacked bar whose widths mean something. */
function MarimekkoPanel(props: MarimekkoProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Marimekko" state={state} defaultHeight={340}>
      {(run) => <Mekko run={run} props={props} />}
    </PanelFrame>
  )
}

export const Marimekko = editable('Marimekko', MarimekkoPanel)
