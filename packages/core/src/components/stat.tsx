import { formatValue } from '../runtime/format.js'
import { pickY } from '../runtime/shape.js'
import type { Format } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'

export interface StatProps extends PanelProps {
  query: string
  /** The column holding the value. Default: the first numeric column. Reads the first row. */
  column?: string
  format?: Format
  /** A column in the same row with the comparison value — last period, target. Shows the change. */
  compare?: string
  /** Names the comparison: "vs previous 30 days". */
  compareLabel?: string
  /** Down is good (costs, latency, churn): flips the colour of the change. */
  invert?: boolean
  /** A small trend under the value: a query (default: this one) and its x / y columns. */
  spark?: { query?: string; x?: string; y: string }
}

function Sparkline({ query, x, y }: { query: string; x?: string; y: string }) {
  const state = useQuery(query)
  const [ref, size] = useSize<HTMLDivElement>()
  const rows = state.run?.result.rows ?? []
  const values = rows.map((row) => Number(row[y])).filter((v) => Number.isFinite(v))
  let path = ''
  let last: [number, number] | undefined
  if (values.length > 1 && size.width > 0) {
    const min = Math.min(...values)
    const max = Math.max(...values)
    const h = size.height - 6
    const points = values.map((v, i): [number, number] => [
      3 + (i / (values.length - 1)) * (size.width - 6),
      3 + h - (max === min ? h / 2 : ((v - min) / (max - min)) * h),
    ])
    path = points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
    last = points[points.length - 1]
  }
  return (
    <div className="odd-spark" ref={ref} data-x={x}>
      {path ? (
        <svg width={size.width} height={size.height} aria-hidden="true">
          <path d={path} className="odd-spark-line" />
          {last ? <circle cx={last[0]} cy={last[1]} r={3} className="odd-spark-dot" /> : null}
        </svg>
      ) : null}
    </div>
  )
}

export function Stat(props: StatProps) {
  const state = useQuery(props.query)
  const ctx = useFormatContext()
  return (
    <PanelFrame {...props} component="Stat" state={state} defaultHeight="auto">
      {(run) => {
        const row = run.result.rows[0] ?? {}
        const column =
          props.column ??
          pickY(run.result.columns, undefined, undefined, props.compare ? [props.compare] : [])[0]
        const value = column ? row[column] : undefined
        const previous = props.compare ? row[props.compare] : undefined
        let delta: number | undefined
        if (typeof value === 'number' && typeof previous === 'number' && previous !== 0) {
          delta = (value - previous) / Math.abs(previous)
        }
        const good =
          delta === undefined || delta === 0 ? undefined : delta > 0 !== Boolean(props.invert)
        return (
          <div className="odd-stat">
            <div className="odd-stat-value">{formatValue(value, props.format, ctx)}</div>
            {delta !== undefined ? (
              <div
                className="odd-stat-delta"
                data-good={good === undefined ? 'flat' : String(good)}
              >
                <span aria-hidden="true">{delta > 0 ? '▲' : delta < 0 ? '▼' : '■'}</span>
                <span>
                  {formatValue(Math.abs(delta), 'percent', ctx)}{' '}
                  <span className="odd-muted">{props.compareLabel ?? 'vs previous period'}</span>
                </span>
              </div>
            ) : props.compare ? (
              <div className="odd-stat-delta" data-good="flat">
                <span className="odd-muted">no comparison value</span>
              </div>
            ) : null}
            {props.spark ? (
              <Sparkline
                query={props.spark.query ?? props.query}
                y={props.spark.y}
                {...(props.spark.x ? { x: props.spark.x } : {})}
              />
            ) : null}
          </div>
        )
      }}
    </PanelFrame>
  )
}
