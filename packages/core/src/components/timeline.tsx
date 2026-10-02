import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { formatValue } from '../runtime/format.js'
import { type Translate, useT } from '../runtime/i18n.js'
import { linear } from '../runtime/scale.js'
import { humanDuration, parseTime, timeTickFormat, timeTicks } from '../runtime/timeseries.js'
import type { QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface TimelineProps extends PanelProps {
  query: string
  /** The lane each bar sits in: a task, a worker, a machine. */
  label: string
  /** When it started and ended (date or datetime). */
  start: string
  end: string
  /** A column grouping bars by colour, with a legend. */
  series?: string
  /** Draw a line at the current time. */
  now?: boolean
}

interface Span {
  lane: string
  start: number
  end: number
  group: number
  rawStart: unknown
  rawEnd: unknown
  groupName: string
}

export function durationText(ms: number, t: Translate): string {
  const { n, unit } = humanDuration(ms)
  if (unit === 'seconds') return t('{n} sec', { n })
  if (unit === 'minutes') return t('{n} min', { n })
  if (unit === 'hours') return t('{n} hr', { n })
  return t('{n} days', { n })
}

const LANE = 26

function Gantt({ run, props }: { run: QueryRun; props: TimelineProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const lanes: string[] = []
  const groups: string[] = []
  const spans: Span[] = []
  for (const row of run.result.rows) {
    const start = parseTime(row[props.start])
    const end = parseTime(row[props.end])
    if (start === undefined || end === undefined) continue
    const lane = String(row[props.label] ?? '—')
    if (!lanes.includes(lane)) lanes.push(lane)
    const groupName = props.series ? String(row[props.series] ?? '—') : ''
    if (props.series && !groups.includes(groupName)) groups.push(groupName)
    spans.push({
      lane,
      start: Math.min(start, end),
      end: Math.max(start, end),
      group: props.series ? groups.indexOf(groupName) : 0,
      rawStart: row[props.start],
      rawEnd: row[props.end],
      groupName,
    })
  }
  if (spans.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('A timeline needs a label column and start and end times.')}
      </div>
    )
  }
  const nowTime = Date.now()
  const min = Math.min(...spans.map((s) => s.start))
  const max = Math.max(...spans.map((s) => s.end), props.now ? nowTime : 0)
  const left = Math.min(180, Math.max(...lanes.map((l) => textWidth(l)), 40) + 12)
  const w = Math.max(0, size.width - left - 12)
  const sx = linear([min, max === min ? min + 1 : max], [left, left + w])
  const ticks = timeTicks(min, max, Math.max(2, Math.floor(w / 90)))
  const tickFormat = timeTickFormat(ticks, ctx.locale)
  const height = lanes.length * LANE + 24
  const active = hover === null ? undefined : spans[hover]

  return (
    <div className="odd-chart">
      {groups.length > 1 ? (
        <ul className="odd-legend">
          {groups.slice(0, 8).map((g, i) => (
            <li key={g}>
              <span className="odd-key odd-key-box" style={{ background: seriesColor(i) }} />
              {g}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="odd-plot odd-timeline" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={height}
            role="img"
            aria-label={`${props.title}: ${t('timeline')}`}
          >
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={sx(tick)}
                  x2={sx(tick)}
                  y1={0}
                  y2={height - 22}
                  className="odd-grid-line"
                />
                <text x={sx(tick)} y={height - 6} textAnchor="middle" className="odd-tick">
                  {tickFormat.format(new Date(tick))}
                </text>
              </g>
            ))}
            {lanes.map((lane, i) => (
              <text
                key={lane}
                x={left - 8}
                y={i * LANE + LANE / 2}
                dy="0.35em"
                textAnchor="end"
                className="odd-tick odd-tick-category"
              >
                {lane.length > 24 ? `${lane.slice(0, 23)}…` : lane}
              </text>
            ))}
            {spans.map((s, i) => {
              const x0 = sx(s.start)
              const width = Math.max(2, sx(s.end) - x0)
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                <rect
                  // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional
                  key={i}
                  x={x0}
                  y={lanes.indexOf(s.lane) * LANE + 5}
                  width={width}
                  height={LANE - 10}
                  rx={Math.min(4, width / 2)}
                  fill={seriesColor(s.group)}
                  className={drill ? 'odd-bar odd-drillable' : 'odd-bar'}
                  data-dim={hover !== null && hover !== i ? '' : undefined}
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onClick={drill ? () => drill.pick(s.lane) : undefined}
                />
              )
            })}
            {props.now && nowTime >= min && nowTime <= max ? (
              <line
                x1={sx(nowTime)}
                x2={sx(nowTime)}
                y1={0}
                y2={height - 22}
                className="odd-timeline-now"
              />
            ) : null}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={sx((active.start + active.end) / 2)}
            top={Math.max(0, lanes.indexOf(active.lane) * LANE - 60)}
            width={size.width}
            title={active.lane}
            rows={[
              ...(props.series
                ? [{ color: seriesColor(active.group), label: t('Group'), value: active.groupName }]
                : []),
              { label: t('Start'), value: formatValue(active.rawStart, undefined, ctx) },
              { label: t('End'), value: formatValue(active.rawEnd, undefined, ctx) },
              { label: t('Duration'), value: durationText(active.end - active.start, t) },
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** What ran when, and for how long: jobs, deployments, incidents, projects. */
function TimelinePanel(props: TimelineProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Timeline" state={state} defaultHeight={320}>
      {(run) => <Gantt run={run} props={props} />}
    </PanelFrame>
  )
}

export const Timeline = editable('Timeline', TimelinePanel)
