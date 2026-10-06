import { useId, useState } from 'react'
import type { Row } from '../config.js'
import { seriesColor } from '../runtime/color.js'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear } from '../runtime/scale.js'
import { parseTime, timeTickFormat, timeTicks } from '../runtime/timeseries.js'
import type { QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { durationText } from './timeline.js'
import { ChartTooltip } from './tooltip.js'

export interface GanttProps extends PanelProps {
  query: string
  /** The task's name, one row each. */
  label: string
  /** First and last day (or exact datetimes). A date-only end is inclusive: 10-01 to 10-03 is three days. */
  start: string
  end: string
  /** The column `after` refers to. Default: `label`. */
  id?: string
  /** Predecessors, comma-separated ids: draws finish-to-start arrows and flags a task that starts too early. */
  after?: string
  /** Done so far, 0–1 (or 0–100). */
  progress?: string
  /** A truthy column marks a milestone; a row with no end is one too. */
  milestone?: string
  /** A phase column: its tasks sit together under a summary bar. */
  group?: string
  /** A column colouring bars, with a legend. */
  series?: string
  /**
   * A query listing days off: `date` (YYYY-MM-DD or YYYYMMDD) and an optional
   * `name`. A row with `isHoliday` false is a working day (a make-up Saturday).
   * Weekends are off unless a row says otherwise.
   */
  holidays?: string
  /** Draw a line at the current time. */
  now?: boolean
}

const DAY = 86_400_000
const LANE = 26
const AXIS = 24
const BAR_HALF = (LANE - 10) / 2
const DIAMOND = 7

interface Task {
  id: string
  label: string
  start: number
  /** Where the bar ends: the day after a date-only end. */
  stop: number
  dateOnly: boolean
  rawStart: unknown
  rawEnd: unknown
  progress?: number
  milestone: boolean
  after: string[]
  group: string
  series: number
  seriesName: string
}

type Line =
  | { kind: 'group'; name: string; start: number; stop: number }
  | { kind: 'task'; task: Task }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function isDateOnly(value: unknown): boolean {
  return typeof value === 'string' && DATE_ONLY.test(value.trim())
}

function nextDay(time: number, days = 1): number {
  const d = new Date(time)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

function dayKey(time: number): string {
  const d = new Date(time)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function truthy(value: unknown): boolean {
  if (typeof value === 'string')
    return !['', '0', 'false', 'no', 'n'].includes(value.trim().toLowerCase())
  return Boolean(value)
}

function pick(row: Row, names: string[]): unknown {
  for (const name of names) if (name in row) return row[name]
  return undefined
}

/** Days off by date: from the holidays query, or weekends alone without one. */
export function daysOff(rows: Row[] | undefined): {
  off: (time: number) => boolean
  name: (time: number) => string | undefined
} {
  const listed = new Map<string, { off: boolean; name?: string }>()
  for (const row of rows ?? []) {
    let raw = pick(row, ['date', 'day']) ?? Object.values(row)[0]
    if (typeof raw === 'number') raw = String(raw)
    if (typeof raw !== 'string') continue
    const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim())
    const time = parseTime(compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : raw)
    if (time === undefined) continue
    const flag = pick(row, ['isHoliday', 'is_holiday', 'holiday', 'off'])
    const name = pick(row, ['name', 'description', 'holiday_name'])
    listed.set(dayKey(time), {
      off: flag === undefined || flag === null ? true : truthy(flag),
      name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
    })
  }
  return {
    off: (time) => {
      const entry = listed.get(dayKey(time))
      if (entry) return entry.off
      const weekday = new Date(time).getDay()
      return weekday === 0 || weekday === 6
    },
    name: (time) => listed.get(dayKey(time))?.name,
  }
}

/** Tasks from rows, in query order; rows without a usable start are skipped. */
export function readTasks(
  rows: Row[],
  props: GanttProps,
): { tasks: Task[]; groups: string[]; series: string[] } {
  const tasks: Task[] = []
  const groups: string[] = []
  const series: string[] = []
  for (const row of rows) {
    const rawStart = row[props.start]
    const rawEnd = row[props.end]
    const start = parseTime(rawStart)
    if (start === undefined) continue
    const end = parseTime(rawEnd)
    const dateOnly = isDateOnly(rawStart) && (end === undefined || isDateOnly(rawEnd))
    const milestone = end === undefined || (props.milestone ? truthy(row[props.milestone]) : false)
    const last = end === undefined ? start : Math.max(start, end)
    const stop = milestone ? start : dateOnly ? nextDay(last) : last
    const group = props.group ? String(row[props.group] ?? '—') : ''
    if (props.group && !groups.includes(group)) groups.push(group)
    const seriesName = props.series ? String(row[props.series] ?? '—') : ''
    if (props.series && !series.includes(seriesName)) series.push(seriesName)
    let progress: number | undefined
    const rawProgress = props.progress ? row[props.progress] : null
    if (rawProgress !== null && rawProgress !== undefined && rawProgress !== '') {
      const value = Number(rawProgress)
      if (Number.isFinite(value))
        progress = Math.min(1, Math.max(0, value > 1 ? value / 100 : value))
    }
    const label = String(row[props.label] ?? '—')
    const rawAfter = props.after ? row[props.after] : undefined
    tasks.push({
      id: String(row[props.id ?? props.label] ?? label),
      label,
      start,
      stop,
      dateOnly,
      rawStart,
      rawEnd,
      progress,
      milestone,
      after:
        typeof rawAfter === 'string' || typeof rawAfter === 'number'
          ? String(rawAfter)
              .replace(/^\[|\]$/g, '')
              .split(/[,，;]/)
              .map((s) => s.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean)
          : [],
      group,
      series: props.series ? series.indexOf(seriesName) : 0,
      seriesName,
    })
  }
  return { tasks, groups, series }
}

/** A dependency is broken when the task starts before its predecessor is done. */
export function startsTooEarly(task: Task, before: Task): boolean {
  // A date-only milestone is met by the end of its day, so it may share its predecessor's last day.
  const at = task.milestone && task.dateOnly ? nextDay(task.start) : task.start
  return at < (before.milestone ? before.start : before.stop)
}

function lines(tasks: Task[], groups: string[]): Line[] {
  if (groups.length === 0) return tasks.map((task) => ({ kind: 'task', task }))
  const out: Line[] = []
  for (const name of groups) {
    const members = tasks.filter((task) => task.group === name)
    out.push({
      kind: 'group',
      name,
      start: Math.min(...members.map((m) => m.start)),
      stop: Math.max(...members.map((m) => m.stop)),
    })
    for (const task of members) out.push({ kind: 'task', task })
  }
  return out
}

function Chart({
  run,
  holidays,
  props,
}: {
  run: QueryRun
  holidays: Row[] | undefined
  props: GanttProps
}) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const marker = `odd-gantt-${useId().replace(/[^\w-]/g, '')}`
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const { tasks, groups, series } = readTasks(run.result.rows, props)
  if (tasks.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('A Gantt chart needs a label column and start and end dates.')}
      </div>
    )
  }
  const calendar = daysOff(holidays)
  const rows = lines(tasks, groups)
  const rowOf = new Map<Task, number>()
  rows.forEach((line, i) => {
    if (line.kind === 'task') rowOf.set(line.task, i)
  })
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const unknown = [...new Set(tasks.flatMap((task) => task.after.filter((id) => !byId.has(id))))]
  const links = tasks.flatMap((task) =>
    task.after.flatMap((id) => {
      const before = byId.get(id)
      return before && before !== task
        ? [{ from: before, to: task, late: startsTooEarly(task, before) }]
        : []
    }),
  )
  const conflicts = links.filter((link) => link.late).length

  const nowTime = Date.now()
  const min = Math.min(...tasks.map((task) => task.start))
  let max = Math.max(...tasks.map((task) => task.stop))
  if (props.now && nowTime > max && nowTime - max < (max - min) / 4) max = nowTime
  if (max <= min) max = min + DAY
  const indent = groups.length > 0 ? 12 : 0
  const left = Math.min(
    220,
    Math.max(
      40,
      ...rows.map(
        (line) =>
          textWidth(line.kind === 'group' ? line.name : line.task.label) +
          (line.kind === 'task' ? indent : 0),
      ),
    ) + 12,
  )
  const w = Math.max(0, size.width - left - 12)
  const sx = linear([min, max], [left, left + w])
  const ticks = timeTicks(min, max, Math.max(2, Math.floor(w / 90)))
  const tickFormat = timeTickFormat(ticks, ctx.locale)
  const height = AXIS + rows.length * LANE + 4
  const mid = (row: number) => AXIS + row * LANE + LANE / 2

  // Days off, shaded only while a day is wide enough to read.
  const off: { x: number; width: number; name?: string }[] = []
  const firstDay = new Date(min)
  firstDay.setHours(0, 0, 0, 0)
  if (w / ((max - min) / DAY) >= 3) {
    for (let day = firstDay.getTime(); day < max; day = nextDay(day)) {
      if (!calendar.off(day)) continue
      const x0 = sx(Math.max(day, min))
      off.push({ x: x0, width: sx(Math.min(nextDay(day), max)) - x0, name: calendar.name(day) })
    }
  }

  const workingDays = (task: Task) => {
    let n = 0
    for (let day = task.start; day < task.stop; day = nextDay(day)) if (!calendar.off(day)) n += 1
    return n
  }

  const diamondX = (task: Task) =>
    task.dateOnly ? (sx(task.start) + sx(nextDay(task.start))) / 2 : sx(task.start)

  // Elbows into a bar's start; into and out of a diamond, vertically through its tip.
  const linkPath = (from: Task, to: Task): string => {
    const y1 = mid(rowOf.get(from) ?? 0)
    const y2 = mid(rowOf.get(to) ?? 0)
    const down = y2 > y1 ? 1 : -1
    const between = y2 - (down * LANE) / 2
    const out = from.milestone
      ? { x: diamondX(from), y: y1 + down * DIAMOND }
      : { x: sx(from.stop), y: y1 }
    if (to.milestone) {
      const cx = diamondX(to)
      const tip = y2 - down * (DIAMOND + 1)
      if (from.milestone) return `M${out.x},${out.y} V${between} H${cx} V${tip}`
      if (cx >= sx(from.start) && cx <= out.x) return `M${cx},${y1 + down * BAR_HALF} V${tip}`
      if (cx > out.x) return `M${out.x},${y1} H${cx} V${tip}`
      return `M${out.x},${y1} H${out.x + 6} V${between} H${cx} V${tip}`
    }
    const x2 = sx(to.start)
    if (from.milestone) {
      return x2 - 4 >= out.x
        ? `M${out.x},${out.y} V${y2} H${x2 - 1}`
        : `M${out.x},${out.y} V${between} H${x2 - 8} V${y2} H${x2 - 1}`
    }
    const turn = out.x + 6
    return x2 - 4 >= turn
      ? `M${out.x},${y1} H${turn} V${y2} H${x2 - 1}`
      : `M${out.x},${y1} H${turn} V${between} H${x2 - 8} V${y2} H${x2 - 1}`
  }

  const active = hover === null ? undefined : tasks[hover]
  const activeRow = active ? (rowOf.get(active) ?? 0) : 0
  const lateFor = (task: Task) =>
    links.filter((link) => link.to === task && link.late).map((link) => link.from.label)

  const tipRows = active
    ? [
        ...(props.group ? [{ label: t('Phase'), value: active.group }] : []),
        ...(props.series
          ? [
              {
                color: seriesColor(active.series),
                label: t('Group'),
                value: active.seriesName,
              },
            ]
          : []),
        {
          label: active.milestone ? t('Date') : t('Start'),
          value: formatValue(active.rawStart, active.dateOnly ? 'date' : undefined, ctx),
        },
        ...(active.milestone
          ? []
          : [
              {
                label: t('End'),
                value: formatValue(active.rawEnd, active.dateOnly ? 'date' : undefined, ctx),
              },
            ]),
        ...(active.milestone
          ? []
          : [
              {
                label: t('Duration'),
                value: active.dateOnly
                  ? `${t('{n} days', { n: Math.round((active.stop - active.start) / DAY) })} · ${t('{n} working days', { n: workingDays(active) })}`
                  : durationText(active.stop - active.start, t),
              },
            ]),
        ...(active.progress === undefined
          ? []
          : [{ label: t('Done'), value: formatValue(active.progress, 'percent', ctx) }]),
        ...(active.after.length > 0
          ? [
              {
                label: t('After'),
                value: active.after.map((id) => byId.get(id)?.label ?? id).join(', '),
              },
            ]
          : []),
        ...lateFor(active).map((name) => ({
          label: t('Starts too early'),
          value: t('before {name} ends', { name }),
        })),
      ]
    : []
  // Above the row in the chart's lower half, below it in the upper, so the panel never clips it.
  const tipTop =
    activeRow * 2 > rows.length
      ? Math.max(0, AXIS + activeRow * LANE - (tipRows.length * 20 + 40))
      : AXIS + (activeRow + 1) * LANE

  return (
    <div className="odd-chart">
      {series.length > 1 || conflicts > 0 || unknown.length > 0 ? (
        <ul className="odd-legend">
          {series.length > 1
            ? series.slice(0, 8).map((name, i) => (
                <li key={name}>
                  <span className="odd-key odd-key-box" style={{ background: seriesColor(i) }} />
                  {name}
                </li>
              ))
            : null}
          {conflicts > 0 ? (
            <li>
              <span className="odd-key odd-gantt-late-key" />
              {t('Started before a predecessor ended: {n}', { n: conflicts })}
            </li>
          ) : null}
          {unknown.length > 0 ? (
            <li className="odd-map-note" title={unknown.join(', ')}>
              {t('Unknown predecessors: {names}', {
                names: unknown.slice(0, 3).join(', ') + (unknown.length > 3 ? '…' : ''),
              })}
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="odd-plot odd-gantt" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={height}
            role="img"
            aria-label={`${props.title}: ${t('Gantt chart')}`}
          >
            <defs>
              <marker
                id={marker}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" className="odd-gantt-arrowhead" />
              </marker>
              <marker
                id={`${marker}-late`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" className="odd-gantt-arrowhead odd-gantt-late" />
              </marker>
            </defs>
            {off.map((day) => (
              <rect
                key={day.x}
                x={day.x}
                y={AXIS}
                width={Math.max(0, day.width)}
                height={height - AXIS}
                className={day.name ? 'odd-gantt-off odd-gantt-holiday' : 'odd-gantt-off'}
              >
                {day.name ? <title>{day.name}</title> : null}
              </rect>
            ))}
            {ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={sx(tick)}
                  x2={sx(tick)}
                  y1={AXIS - 4}
                  y2={height}
                  className="odd-grid-line"
                />
                <text x={sx(tick)} y={AXIS - 10} textAnchor="middle" className="odd-tick">
                  {tickFormat.format(new Date(tick))}
                </text>
              </g>
            ))}
            {rows.map((line, i) =>
              line.kind === 'group' ? (
                <g key={`g-${line.name}`}>
                  <text x={8} y={mid(i)} dy="0.35em" className="odd-tick odd-gantt-group-label">
                    {line.name.length > 26 ? `${line.name.slice(0, 25)}…` : line.name}
                  </text>
                  <path
                    d={`M${sx(line.start)},${mid(i) + 4} V${mid(i) - 3} H${sx(line.stop)} V${mid(i) + 4}`}
                    className="odd-gantt-summary"
                  />
                </g>
              ) : (
                <text
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                  key={`t-${i}`}
                  x={left - 8}
                  y={mid(i)}
                  dy="0.35em"
                  textAnchor="end"
                  className="odd-tick odd-tick-category"
                >
                  {line.task.label.length > 24
                    ? `${line.task.label.slice(0, 23)}…`
                    : line.task.label}
                </text>
              ),
            )}
            {links.map((link, i) => {
              const d = linkPath(link.from, link.to)
              return (
                <path
                  // biome-ignore lint/suspicious/noArrayIndexKey: links are positional
                  key={i}
                  d={d}
                  className={link.late ? 'odd-gantt-link odd-gantt-late' : 'odd-gantt-link'}
                  markerEnd={`url(#${link.late ? `${marker}-late` : marker})`}
                />
              )
            })}
            {tasks.map((task, i) => {
              const y = mid(rowOf.get(task) ?? 0)
              const dim = hover !== null && hover !== i ? '' : undefined
              const events = {
                onPointerEnter: () => setHover(i),
                onPointerLeave: () => setHover(null),
                onClick: drill ? () => drill.pick(task.label) : undefined,
              }
              const className = drill ? 'odd-bar odd-drillable' : 'odd-bar'
              if (task.milestone) {
                const cx = diamondX(task)
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                  <path
                    // biome-ignore lint/suspicious/noArrayIndexKey: tasks are positional
                    key={i}
                    d={`M${cx},${y - DIAMOND} L${cx + DIAMOND},${y} L${cx},${y + DIAMOND} L${cx - DIAMOND},${y} z`}
                    fill={seriesColor(task.series)}
                    className={`${className} odd-gantt-milestone`}
                    data-dim={dim}
                    {...events}
                  />
                )
              }
              const x0 = sx(task.start)
              const width = Math.max(2, sx(task.stop) - x0)
              const radius = Math.min(4, width / 2)
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                <g
                  // biome-ignore lint/suspicious/noArrayIndexKey: tasks are positional
                  key={i}
                  className={className}
                  data-dim={dim}
                  {...events}
                >
                  <rect
                    x={x0}
                    y={y - BAR_HALF}
                    width={width}
                    height={BAR_HALF * 2}
                    rx={radius}
                    fill={seriesColor(task.series)}
                    className={task.progress === undefined ? undefined : 'odd-gantt-remaining'}
                  />
                  {task.progress ? (
                    <rect
                      x={x0}
                      y={y - BAR_HALF}
                      width={width * task.progress}
                      height={BAR_HALF * 2}
                      rx={radius}
                      fill={seriesColor(task.series)}
                    />
                  ) : null}
                </g>
              )
            })}
            {props.now && nowTime >= min && nowTime <= max ? (
              <line
                x1={sx(nowTime)}
                x2={sx(nowTime)}
                y1={AXIS - 4}
                y2={height}
                className="odd-timeline-now"
              />
            ) : null}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={active.milestone ? sx(active.start) : sx((active.start + active.stop) / 2)}
            top={tipTop}
            width={size.width}
            title={active.label}
            rows={tipRows}
          />
        ) : null}
      </div>
    </div>
  )
}

/** A project plan: tasks over working days, with phases, progress, milestones and dependencies. */
function GanttPanel(props: GanttProps) {
  const state = useQuery(props.query)
  const holidays = useQuery(props.holidays)
  const count = state.run
    ? state.run.result.rows.length +
      (props.group ? new Set(state.run.result.rows.map((r) => r[props.group as string])).size : 0)
    : 8
  return (
    <PanelFrame
      {...props}
      component="Gantt"
      state={state}
      defaultHeight={Math.min(640, 96 + count * LANE)}
    >
      {(run) => <Chart run={run} holidays={holidays.run?.result.rows} props={props} />}
    </PanelFrame>
  )
}

export const Gantt = editable('Gantt', GanttPanel)
