import { type MouseEvent, type ReactNode, useState } from 'react'
import {
  type FormatContext,
  formatCategory,
  formatShort,
  formatValue,
  tickFormatter,
} from '../runtime/format.js'
import { type Translate, useT } from '../runtime/i18n.js'
import { linear, niceDomain, thinIndices } from '../runtime/scale.js'
import { humanize, pickX, pickY, type Series, shapeSeries } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'

export interface XYProps extends PanelProps {
  query: string
  /** The category or time column. Default: the first non-numeric column. */
  x?: string
  /** One or more measure columns. Default: every numeric column except x. */
  y?: string | string[]
  /** For long data: a column naming the series. Pivots `y` (one measure) into one line or bar per value. */
  series?: string
  format?: Format
  stacked?: boolean
  /** Rename series in the legend and tooltip: `{ revenue_twd: 'Revenue' }`. */
  labels?: Record<string, string>
}

export interface LineChartProps extends XYProps {
  /** Fill under the lines. */
  area?: boolean
}

export interface BarChartProps extends XYProps {
  /** Bars run left to right — the better form for long category names and rankings. */
  horizontal?: boolean
}

type Kind = 'line' | 'area' | 'bar'

const color = (index: number) => `var(--odd-series-${(index % 8) + 1})`

interface Prepared {
  categories: unknown[]
  series: Series[]
  x: string
}

function prepare(run: QueryRun, props: XYProps, t: Translate): Prepared | string {
  const { columns, rows } = run.result
  const x = pickX(columns, props.x)
  if (!x) return t('The query returned no columns.')
  const y = pickY(columns, x, props.y)
  if (y.length === 0)
    return t('No numeric column to plot. Name one with y="…" (columns: {columns}).', {
      columns: columns.map((c) => c.name).join(', '),
    })
  const shaped = shapeSeries(rows, x, props.series ? y.slice(0, 1) : y, props.series)
  for (const s of shaped.series) {
    s.label =
      s.key === '__other'
        ? t('Other')
        : (props.labels?.[s.key] ?? (props.series ? s.label : humanize(s.key)))
  }
  return { ...shaped, x }
}

function Legend({ series, kind }: { series: Series[]; kind: Kind }) {
  if (series.length < 2) return null
  return (
    <ul className="odd-legend">
      {series.map((s, i) => (
        <li key={s.key}>
          <span
            className={`odd-key odd-key-${kind === 'bar' ? 'box' : 'line'}`}
            style={{ background: color(i) }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

interface TooltipState {
  index: number
  left: number
  top: number
}

function Tooltip({
  state,
  prepared,
  format,
  ctx,
  width,
}: {
  state: TooltipState
  prepared: Prepared
  format: Format | undefined
  ctx: FormatContext
  width: number
}) {
  const category = prepared.categories[state.index]
  const flip = state.left > width / 2
  return (
    <div
      className="odd-tooltip"
      style={{
        top: state.top,
        left: flip ? undefined : state.left + 12,
        right: flip ? width - state.left + 12 : undefined,
      }}
    >
      <div className="odd-tooltip-title">{formatValue(category, undefined, ctx)}</div>
      {prepared.series.map((s, i) => (
        <div className="odd-tooltip-row" key={s.key}>
          <span className="odd-key odd-key-box" style={{ background: color(i) }} />
          <span className="odd-tooltip-label">{s.label}</span>
          <span className="odd-tooltip-value">
            {formatValue(s.values[state.index], format, ctx)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** A bar with a 4px rounded data end and a square end on the baseline. */
function barPath(
  x: number,
  y: number,
  w: number,
  h: number,
  end: 'top' | 'bottom' | 'right' | 'left' | 'none',
): string {
  const r = Math.max(0, Math.min(4, w / 2, h / 2))
  if (end === 'none' || r === 0) return `M${x},${y}h${w}v${h}h${-w}Z`
  switch (end) {
    case 'top':
      return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
    case 'bottom':
      return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`
    case 'right':
      return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
    case 'left':
      return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`
  }
}

function stackedExtent(series: Series[], count: number, stacked: boolean): number[] {
  if (!stacked) return series.flatMap((s) => s.values.filter((v): v is number => v !== null))
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    let pos = 0
    let neg = 0
    for (const s of series) {
      const v = s.values[i] ?? 0
      if (v >= 0) pos += v
      else neg += v
    }
    out.push(pos, neg)
  }
  return out
}

const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/

/** No DOM to measure against before the first paint, so estimate: CJK glyphs are about twice as wide. */
function estimateWidth(text: string): number {
  let width = 4
  for (const ch of text) width += WIDE.test(ch) ? 12 : 6.6
  return width
}

function Plot({
  run,
  props,
  kind,
}: {
  run: QueryRun
  props: BarChartProps & LineChartProps
  kind: Kind
}) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<TooltipState | null>(null)
  const prepared = prepare(run, props, t)
  const drill = useDrill(props.drill)
  if (typeof prepared === 'string') return <div className="odd-panel-message">{prepared}</div>

  const { categories, series } = prepared
  const n = categories.length
  const stacked = Boolean(props.stacked) && series.length > 1
  const horizontal = kind === 'bar' && Boolean(props.horizontal)
  const domain = niceDomain(stackedExtent(series, n, stacked), horizontal ? 4 : 5, true)
  const tickLabels = domain.ticks.map(tickFormatter(domain.ticks, props.format, ctx))
  const room = size.width * 0.38 - 12
  const categoryLabels = categories.map((c) => {
    let label = formatCategory(c, ctx, horizontal ? 22 : 14)
    while (horizontal && size.width > 0 && label.length > 4 && estimateWidth(label) > room) {
      label = `${label.slice(0, label.endsWith('…') ? -2 : -1)}…`
    }
    return label
  })

  const width = size.width
  const height = size.height
  const tipLabels = horizontal && !stacked && series.length === 1 && n <= 16
  const tipWidth = tipLabels
    ? Math.max(
        0,
        ...(series[0]?.values ?? []).map((v) =>
          v === null ? 0 : estimateWidth(formatShort(v, props.format, ctx)),
        ),
      )
    : 0
  const margin = horizontal
    ? {
        top: 4,
        right: Math.max(16, tipWidth + 8),
        bottom: 22,
        left: Math.min(width * 0.38, Math.max(...categoryLabels.map(estimateWidth), 24) + 8),
      }
    : { top: 8, right: 12, bottom: 24, left: Math.max(...tickLabels.map(estimateWidth), 20) + 6 }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const innerH = Math.max(0, height - margin.top - margin.bottom)

  const value = horizontal
    ? linear([domain.min, domain.max], [margin.left, margin.left + innerW])
    : linear([domain.min, domain.max], [margin.top + innerH, margin.top])
  const band = (horizontal ? innerH : innerW) / Math.max(1, n)
  const center = (i: number) =>
    kind === 'bar'
      ? (horizontal ? margin.top : margin.left) + band * (i + 0.5)
      : margin.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW)

  const fit = horizontal
    ? Math.floor(innerH / 16)
    : Math.floor(innerW / Math.max(56, Math.max(...categoryLabels.map(estimateWidth)) + 12))
  const thinned = thinIndices(n, Math.max(2, fit))
  // On a line the end labels hang inward from the plot edges rather than
  // centring, so a neighbour that clears a centred label can still collide.
  const endAnchored = kind !== 'bar' && !horizontal && n > 1
  const shownLabels = endAnchored
    ? thinned.filter((i) => {
        if (i === 0 || i === n - 1) return true
        const half = estimateWidth(categoryLabels[i] ?? '') / 2
        const left = center(0) + estimateWidth(categoryLabels[0] ?? '') + 8
        const right = center(n - 1) - estimateWidth(categoryLabels[n - 1] ?? '') - 8
        return center(i) - half >= left && center(i) + half <= right
      })
    : thinned

  const indexAt = (event: MouseEvent<SVGRectElement>): number => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!rect) return 0
    const px = horizontal
      ? event.clientY - rect.top - margin.top
      : event.clientX - rect.left - margin.left
    if (kind === 'bar') return Math.max(0, Math.min(n - 1, Math.floor(px / band)))
    return Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : (px / innerW) * (n - 1))))
  }

  const marks: ReactNode[] = []
  const zero = value(0)

  if (kind === 'bar') {
    const groupCount = stacked ? 1 : series.length
    const group = band * 0.72
    const thickness = Math.max(2, Math.min(24, (group - 2 * (groupCount - 1)) / groupCount))
    const used = thickness * groupCount + 2 * (groupCount - 1)
    for (let i = 0; i < n; i += 1) {
      const start = center(i) - used / 2
      let pos = 0
      let neg = 0
      const lastPos = stacked ? series.map((s) => (s.values[i] ?? 0) > 0).lastIndexOf(true) : -1
      const lastNeg = stacked ? series.map((s) => (s.values[i] ?? 0) < 0).lastIndexOf(true) : -1
      series.forEach((s, si) => {
        const v = s.values[i]
        if (v === null || v === undefined || v === 0) return
        const offset = stacked ? start : start + si * (thickness + 2)
        let a: number
        let b: number
        let roundEnd: boolean
        if (stacked) {
          const base = v >= 0 ? pos : neg
          a = value(base)
          b = value(base + v)
          roundEnd = v >= 0 ? si === lastPos : si === lastNeg
          if (v >= 0) pos += v
          else neg += v
        } else {
          a = zero
          b = value(v)
          roundEnd = true
        }
        const gap = stacked && !(v >= 0 ? pos === v : neg === v) ? 2 : 0
        let d: string
        if (horizontal) {
          const x0 = Math.min(a, b) + (v >= 0 ? gap : 0)
          const w = Math.max(0, Math.abs(b - a) - gap)
          d = barPath(x0, offset, w, thickness, roundEnd ? (v >= 0 ? 'right' : 'left') : 'none')
        } else {
          const y0 = Math.min(a, b) + (v < 0 ? gap : 0)
          const h = Math.max(0, Math.abs(b - a) - gap)
          d = barPath(offset, y0, thickness, h, roundEnd ? (v >= 0 ? 'top' : 'bottom') : 'none')
        }
        marks.push(
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: marks are positional and rebuilt every render
            key={`${si}-${i}`}
            d={d}
            fill={color(si)}
            className="odd-bar"
            data-dim={
              (hover && hover.index !== i) || (drill?.anyActive && !drill.isActive(categories[i]))
                ? ''
                : undefined
            }
          />,
        )
      })
      if (tipLabels) {
        const v = series[0]?.values[i]
        if (v !== null && v !== undefined) {
          const tip = value(v)
          marks.push(
            <text
              key={`label-${i}`}
              x={tip + (v >= 0 ? 6 : -6)}
              y={center(i)}
              dy="0.35em"
              textAnchor={v >= 0 ? 'start' : 'end'}
              className="odd-value-label"
            >
              {formatShort(v, props.format, ctx)}
            </text>,
          )
        }
      }
    }
  } else {
    const base = new Array<number>(n).fill(0)
    series.forEach((s, si) => {
      const tops: ([number, number] | null)[] = s.values.map((v, i) => {
        if (v === null) return null
        const lower = stacked ? (base[i] as number) : 0
        return [lower, lower + v]
      })
      if (stacked) {
        s.values.forEach((v, i) => {
          base[i] = (base[i] as number) + (v ?? 0)
        })
      }
      const segments: [number, number, number][][] = []
      let current: [number, number, number][] = []
      tops.forEach((t, i) => {
        if (!t) {
          if (current.length) segments.push(current)
          current = []
          return
        }
        current.push([center(i), value(t[1]), value(t[0])])
      })
      if (current.length) segments.push(current)
      segments.forEach((points, k) => {
        const line = points
          .map(([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`)
          .join('')
        if (kind === 'area') {
          const back = [...points]
            .reverse()
            .map(([px, , py0]) => `L${px.toFixed(1)},${py0.toFixed(1)}`)
            .join('')
          marks.push(
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: marks are positional and rebuilt every render
              key={`fill-${si}-${k}`}
              d={`${line}${back}Z`}
              fill={color(si)}
              className={stacked ? 'odd-area-stacked' : 'odd-area'}
            />,
          )
        }
        marks.push(
          // biome-ignore lint/suspicious/noArrayIndexKey: marks are positional and rebuilt every render
          <path key={`line-${si}-${k}`} d={line} stroke={color(si)} className="odd-line" />,
        )
        if (points.length === 1) {
          const [px, py] = points[0] as [number, number, number]
          marks.push(
            <circle
              // biome-ignore lint/suspicious/noArrayIndexKey: marks are positional and rebuilt every render
              key={`dot-${si}-${k}`}
              cx={px}
              cy={py}
              r={4}
              fill={color(si)}
              className="odd-dot"
            />,
          )
        }
      })
    })
    if (hover) {
      const cx = center(hover.index)
      marks.push(
        <line
          key="crosshair"
          x1={cx}
          x2={cx}
          y1={margin.top}
          y2={margin.top + innerH}
          className="odd-crosshair"
        />,
      )
      let acc = 0
      series.forEach((s, si) => {
        const v = s.values[hover.index]
        if (v === null || v === undefined) return
        acc += v
        marks.push(
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: marks are positional and rebuilt every render
            key={`hover-${si}`}
            cx={cx}
            cy={value(stacked ? acc : v)}
            r={4}
            fill={color(si)}
            className="odd-dot"
          />,
        )
      })
    }
  }

  const tooltip = hover ? (
    <Tooltip state={hover} prepared={prepared} format={props.format} ctx={ctx} width={width} />
  ) : null

  return (
    <div className="odd-chart">
      <Legend series={series} kind={kind} />
      <div className="odd-plot" ref={ref}>
        {width > 0 && height > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`${props.title}: ${kind} chart of ${series.map((s) => s.label).join(', ')} by ${prepared.x}`}
          >
            {domain.ticks.map((t, i) =>
              horizontal ? (
                <g key={t}>
                  <line
                    x1={value(t)}
                    x2={value(t)}
                    y1={margin.top}
                    y2={margin.top + innerH}
                    className={t === 0 ? 'odd-baseline' : 'odd-grid-line'}
                  />
                  <text
                    x={value(t)}
                    y={margin.top + innerH + 15}
                    textAnchor="middle"
                    className="odd-tick"
                  >
                    {tickLabels[i]}
                  </text>
                </g>
              ) : (
                <g key={t}>
                  <line
                    x1={margin.left}
                    x2={margin.left + innerW}
                    y1={value(t)}
                    y2={value(t)}
                    className={t === 0 ? 'odd-baseline' : 'odd-grid-line'}
                  />
                  <text
                    x={margin.left - 6}
                    y={value(t)}
                    dy="0.32em"
                    textAnchor="end"
                    className="odd-tick"
                  >
                    {tickLabels[i]}
                  </text>
                </g>
              ),
            )}
            {kind === 'bar' && hover ? (
              horizontal ? (
                <rect
                  x={margin.left}
                  y={margin.top + band * hover.index}
                  width={innerW}
                  height={band}
                  className="odd-hover-band"
                />
              ) : (
                <rect
                  x={margin.left + band * hover.index}
                  y={margin.top}
                  width={band}
                  height={innerH}
                  className="odd-hover-band"
                />
              )
            ) : null}
            {marks}
            {shownLabels.map((i) =>
              horizontal ? (
                <text
                  key={i}
                  x={margin.left - 8}
                  y={center(i)}
                  dy="0.35em"
                  textAnchor="end"
                  className="odd-tick odd-tick-category"
                >
                  {categoryLabels[i]}
                </text>
              ) : (
                <text
                  key={i}
                  x={center(i)}
                  y={margin.top + innerH + 16}
                  textAnchor={
                    kind !== 'bar' && n > 1 && i === 0
                      ? 'start'
                      : kind !== 'bar' && n > 1 && i === n - 1
                        ? 'end'
                        : 'middle'
                  }
                  className="odd-tick"
                >
                  {categoryLabels[i]}
                </text>
              ),
            )}
            {/* biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path */}
            <rect
              x={margin.left}
              y={margin.top}
              width={innerW}
              height={innerH}
              fill="transparent"
              className={drill ? 'odd-drillable' : undefined}
              onClick={drill ? (event) => drill.pick(categories[indexAt(event)]) : undefined}
              onPointerMove={(event) => {
                const index = indexAt(event)
                const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
                const top = rect ? Math.min(event.clientY - rect.top, height - 40) : 0
                setHover({
                  index,
                  left: horizontal ? (rect ? event.clientX - rect.left : 0) : center(index),
                  top: Math.max(0, top - 10),
                })
              }}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        ) : null}
        {tooltip}
      </div>
    </div>
  )
}

function XYPanel(props: BarChartProps & LineChartProps & { kind: Kind; component: string }) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component={props.component} state={state} defaultHeight={300}>
      {(run) => <Plot run={run} props={props} kind={props.kind} />}
    </PanelFrame>
  )
}

/** Change over time. One line per measure, or per value of `series`. */
function LineChartPanel(props: LineChartProps) {
  return <XYPanel {...props} kind={props.area ? 'area' : 'line'} component="LineChart" />
}

/** A line chart with the area under each line washed in — stack it for part-of-whole over time. */
function AreaChartPanel(props: XYProps) {
  return <XYPanel {...props} kind="area" component="AreaChart" />
}

/** Comparing magnitudes across categories. */
function BarChartPanel(props: BarChartProps) {
  return <XYPanel {...props} kind="bar" component="BarChart" />
}

export const LineChart = editable('LineChart', LineChartPanel)

export const AreaChart = editable('AreaChart', AreaChartPanel)

export const BarChart = editable('BarChart', BarChartPanel)
