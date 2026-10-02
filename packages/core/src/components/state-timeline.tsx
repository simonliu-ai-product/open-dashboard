import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { parseDate } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import {
  humanDuration,
  type Segment,
  stateSegments,
  stateTotals,
} from '../runtime/state-segments.js'
import { timeTickFormat, timeTicks } from '../runtime/timeseries.js'
import type { QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export type StateTone = 'good' | 'warning' | 'critical' | 'neutral'

export interface StateTimelineProps extends PanelProps {
  query: string
  /** When the state began (timestamp or ISO text). */
  x: string
  /** The lane — a service, a machine, a line. */
  series: string
  /** The state's name. */
  state: string
  /** When the state ended. Default: at the lane's next row. */
  end?: string
  /** Map state names to status tones: `{ up: 'good', degraded: 'warning', down: 'critical' }`. */
  states?: Record<string, StateTone>
}

const TONES: Record<StateTone, string> = {
  good: 'var(--odd-good)',
  warning: 'var(--odd-warning, #fab219)',
  critical: 'var(--odd-critical)',
  neutral: 'var(--odd-axis)',
}

function toTime(value: unknown): number {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value
  if (value instanceof Date) return value.getTime()
  return parseDate(value)?.getTime() ?? Number.NaN
}

function Lanes({ run, props }: { run: QueryRun; props: StateTimelineProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ segment: Segment; x: number; y: number } | null>(null)
  const rows = run.result.rows.map((row) => ({
    lane: String(row[props.series] ?? '—'),
    at: toTime(row[props.x]),
    state: String(row[props.state] ?? '—'),
    ...(props.end ? { end: toTime(row[props.end]) } : {}),
  }))
  const { lanes, segments, start, end } = stateSegments(rows)
  if (segments.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('A state timeline needs a timestamp, a lane and a state column.')}
      </div>
    )
  }

  const order: string[] = []
  for (const s of segments) if (!order.includes(s.state)) order.push(s.state)
  const unmapped = order.filter((s) => !props.states?.[s])
  const colour = (state: string) => {
    const tone = props.states?.[state]
    return tone ? TONES[tone] : seriesColor(unmapped.indexOf(state))
  }
  const totals = stateTotals(segments)
  const all = [...totals.values()].reduce((a, b) => a + b, 0) || 1

  const labelWidth = Math.min(160, Math.max(...lanes.map((l) => textWidth(l)), 40) + 12)
  const axis = 22
  const laneHeight = Math.max(14, Math.min(36, (size.height - axis) / Math.max(1, lanes.length)))
  const plotW = Math.max(0, size.width - labelWidth - 8)
  const x = (time: number) => labelWidth + ((time - start) / (end - start || 1)) * plotW
  const ticks = timeTicks(start, end, Math.max(2, Math.floor(plotW / 110)))
  const format = timeTickFormat(ticks, ctx.locale)
  const full = new Intl.DateTimeFormat(ctx.locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  return (
    <div className="odd-chart">
      <ul className="odd-legend">
        {order.map((state) => (
          <li key={state}>
            <span className="odd-key odd-key-box" style={{ background: colour(state) }} />
            {state}
            <span className="odd-muted">{formatValue((totals.get(state) ?? 0) / all)}</span>
          </li>
        ))}
      </ul>
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${order.join(', ')}`}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={0}
                  y2={lanes.length * laneHeight}
                  className="odd-grid-line"
                />
                <text
                  x={x(tick)}
                  y={lanes.length * laneHeight + 15}
                  textAnchor="middle"
                  className="odd-tick"
                >
                  {format.format(new Date(tick))}
                </text>
              </g>
            ))}
            {lanes.map((lane, i) => (
              <text
                key={lane}
                x={labelWidth - 10}
                y={i * laneHeight + laneHeight / 2}
                dy="0.35em"
                textAnchor="end"
                className="odd-tick odd-tick-category"
              >
                {lane.length > 22 ? `${lane.slice(0, 21)}…` : lane}
              </text>
            ))}
            {segments.map((segment) => {
              const lane = lanes.indexOf(segment.lane)
              const x0 = x(segment.start)
              const w = Math.max(1, x(segment.end) - x0 - 1)
              return (
                <rect
                  key={`${segment.lane}|${segment.start}`}
                  x={x0}
                  y={lane * laneHeight + 3}
                  width={w}
                  height={Math.max(4, laneHeight - 6)}
                  rx={Math.min(3, w / 2)}
                  fill={colour(segment.state)}
                  className="odd-state"
                  data-dim={hover && hover.segment !== segment ? '' : undefined}
                  onPointerEnter={() => setHover({ segment, x: x0 + w / 2, y: lane * laneHeight })}
                  onPointerLeave={() => setHover(null)}
                />
              )
            })}
          </svg>
        ) : null}
        {hover ? (
          <ChartTooltip
            left={hover.x}
            top={Math.max(0, hover.y - 30)}
            width={size.width}
            title={`${hover.segment.lane}: ${hover.segment.state}`}
            rows={[
              { label: t('From'), value: full.format(new Date(hover.segment.start)) },
              { label: t('To'), value: full.format(new Date(hover.segment.end)) },
              {
                label: t('Duration'),
                value: humanDuration(hover.segment.end - hover.segment.start),
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  )

  function formatValue(share: number): string {
    return new Intl.NumberFormat(ctx.locale, {
      style: 'percent',
      maximumFractionDigits: share < 0.1 ? 1 : 0,
    }).format(share)
  }
}

/** Which state each lane was in, over time — up, degraded, down; running, idle, stopped. */
function StateTimelinePanel(props: StateTimelineProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="StateTimeline" state={state} defaultHeight={260}>
      {(run) => <Lanes run={run} props={props} />}
    </PanelFrame>
  )
}

export const StateTimeline = editable('StateTimeline', StateTimelinePanel)
