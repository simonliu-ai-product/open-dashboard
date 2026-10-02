import { useState } from 'react'
import { sequential } from '../runtime/color.js'
import { formatValue, parseDate, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { pickY } from '../runtime/shape.js'
import { calendarLayout } from '../runtime/timeseries.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { ChartTooltip } from './tooltip.js'

export interface CalendarHeatmapProps extends PanelProps {
  query: string
  /** The day, as 'YYYY-MM-DD'. */
  x: string
  /** The numeric column that colours each day. Default: the first numeric column. */
  value?: string
  format?: Format
}

function Calendar({ run, props }: { run: QueryRun; props: CalendarHeatmapProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const value = pickY(run.result.columns, props.x, props.value)[0]
  const values = new Map<string, number>()
  for (const row of run.result.rows) {
    const day = String(row[props.x] ?? '').slice(0, 10)
    const n = Number(value ? row[value] : Number.NaN)
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(n))
      values.set(day, (values.get(day) ?? 0) + n)
  }
  if (!value || values.size === 0) {
    return (
      <div className="odd-panel-message">
        {t('A calendar needs a date column and a numeric value column.')}
      </div>
    )
  }
  const layout = calendarLayout(values)
  const shown = layout.cells.map((c) => c.value).filter((v): v is number => v !== undefined)
  const min = Math.min(0, ...shown)
  const max = Math.max(...shown, 1e-9)
  const weekday = new Intl.DateTimeFormat(ctx.locale, { weekday: 'short' })
  const month = new Intl.DateTimeFormat(ctx.locale, { month: 'short' })
  const dayNames = [0, 2, 4].map((offset) => ({
    row: offset,
    text: weekday.format(new Date(2024, 0, 1 + offset)),
  }))
  const left = 30
  const top = 16
  const cell = Math.max(
    4,
    Math.min((size.width - left - 4) / Math.max(1, layout.weeks), (size.height - top - 4) / 7),
  )
  const gap = cell > 8 ? 2 : 1
  const active = hover === null ? undefined : layout.cells[hover]
  const scale = tickFormatter([min, max], props.format, ctx)

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('calendar')}`}
          >
            {dayNames.map((d) => (
              <text
                key={d.row}
                x={left - 6}
                y={top + cell * (d.row + 0.5)}
                dy="0.35em"
                textAnchor="end"
                className="odd-tick"
              >
                {d.text}
              </text>
            ))}
            {layout.months.map((m) => (
              <text key={m.date} x={left + cell * m.col} y={top - 5} className="odd-tick">
                {month.format(parseDate(m.date) as Date)}
              </text>
            ))}
            {layout.cells.map((c, i) => (
              <rect
                key={c.date}
                x={left + cell * c.col + gap / 2}
                y={top + cell * c.row + gap / 2}
                width={Math.max(1, cell - gap)}
                height={Math.max(1, cell - gap)}
                rx={Math.min(2, cell / 5)}
                fill={
                  c.value === undefined
                    ? 'var(--odd-hover)'
                    : sequential((c.value - min) / (max - min || 1))
                }
                className="odd-cell"
                data-dim={hover !== null && hover !== i ? '' : undefined}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            ))}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={left + cell * (active.col + 0.5)}
            top={Math.max(0, top + cell * active.row - 36)}
            width={size.width}
            title={formatValue(active.date, 'date', ctx)}
            rows={[
              {
                label: weekday.format(parseDate(active.date) as Date),
                value: formatValue(active.value ?? null, props.format, ctx),
              },
            ]}
          />
        ) : null}
      </div>
      <div className="odd-scale" aria-hidden="true">
        <span>{scale(min)}</span>
        <span
          className="odd-scale-bar"
          style={{
            background: `linear-gradient(to right, ${sequential(0)}, ${sequential(0.5)}, ${sequential(1)})`,
          }}
        />
        <span>{scale(max)}</span>
      </div>
    </div>
  )
}

/** A year of days at a glance: weekly rhythm, seasons, the odd spike. */
function CalendarHeatmapPanel(props: CalendarHeatmapProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="CalendarHeatmap" state={state} defaultHeight={220}>
      {(run) => <Calendar run={run} props={props} />}
    </PanelFrame>
  )
}

export const CalendarHeatmap = editable('CalendarHeatmap', CalendarHeatmapPanel)
