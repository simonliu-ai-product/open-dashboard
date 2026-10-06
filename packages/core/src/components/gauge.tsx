import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { pickY } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'

export interface GaugeProps extends PanelProps {
  query: string
  /** The value. Default: the first numeric column. Reads the first row. */
  column?: string
  /** The full scale: a number, or a column in the same row. Default 1 — right for a fraction. */
  max?: number | string
  /** A mark on the arc: a number, or a column in the same row — last month, the plan. */
  target?: number | string
  format?: Format
}

function read(row: Record<string, unknown>, ref: number | string | undefined): number | undefined {
  if (typeof ref === 'number') return ref
  if (typeof ref === 'string') {
    const n = Number(row[ref])
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

const START = Math.PI
const SWEEP = Math.PI

function point(cx: number, cy: number, r: number, f: number): [number, number] {
  const a = START + SWEEP * f
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

/** Part of the half circle. It never spans more than 180°, so the arc is always the short one. */
export function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const [x0, y0] = point(cx, cy, r, from)
  const [x1, y1] = point(cx, cy, r, to)
  return `M${x0},${y0}A${r},${r} 0 0 1 ${x1},${y1}`
}

/**
 * A meter: the filled arc is the value, the unfilled track a lighter step of
 * the same hue, the tick the target. One number, read against its scale.
 */
function Meter({ run, props }: { run: QueryRun; props: GaugeProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const row = run.result.rows[0] ?? {}
  const column = props.column ?? pickY(run.result.columns, undefined)[0]
  const value = column ? Number(row[column]) : Number.NaN
  const max = read(row, props.max) ?? 1
  const target = read(row, props.target)
  if (!Number.isFinite(value))
    return <div className="odd-panel-message">{t('Needs a numeric value column.')}</div>

  const fraction = Math.max(0, Math.min(1, max ? value / max : 0))
  const stroke = Math.max(8, Math.min(size.width, size.height) * 0.06)
  const r = Math.max(0, Math.min(size.width / 2 - stroke - 36, size.height - stroke - 30))
  const cx = size.width / 2
  // Centred in the panel: the arc's top to the tick labels under its ends.
  const drawn = r + stroke / 2 + 6 + 26
  const cy = Math.max(0, (size.height - drawn) / 2) + r + stroke / 2 + 6
  const targetFraction =
    target === undefined || !max ? undefined : Math.max(0, Math.min(1, target / max))

  return (
    <div className="odd-gauge" ref={ref}>
      {size.width > 0 && r > 20 ? (
        <svg
          width={size.width}
          height={size.height}
          role="img"
          aria-label={`${props.title}: ${formatValue(value, props.format, ctx)} / ${formatValue(max, props.format, ctx)}`}
        >
          <path d={arc(cx, cy, r, 0, 1)} className="odd-gauge-track" strokeWidth={stroke} />
          {fraction > 0 ? (
            <path
              d={arc(cx, cy, r, 0, Math.max(fraction, 0.004))}
              className="odd-gauge-fill"
              strokeWidth={stroke}
            />
          ) : null}
          {targetFraction !== undefined ? (
            <line
              x1={point(cx, cy, r - stroke / 2 - 4, targetFraction)[0]}
              y1={point(cx, cy, r - stroke / 2 - 4, targetFraction)[1]}
              x2={point(cx, cy, r + stroke / 2 + 4, targetFraction)[0]}
              y2={point(cx, cy, r + stroke / 2 + 4, targetFraction)[1]}
              className="odd-gauge-target"
            />
          ) : null}
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            className="odd-gauge-value"
            style={{ fontSize: Math.max(16, Math.min(34, r * 0.34)) }}
          >
            {formatValue(value, props.format, ctx)}
          </text>
          {/* A plain rate already reads as a share of 1: "88% of 100%" would say nothing more. */}
          {target !== undefined || props.max !== undefined ? (
            <text x={cx} y={cy + 14} textAnchor="middle" className="odd-gauge-caption">
              {target !== undefined
                ? t('{pct} of target', {
                    pct: formatValue(target ? value / target : 0, 'percent', ctx),
                  })
                : t('{pct} of {max}', {
                    pct: formatValue(fraction, 'percent', ctx),
                    max: formatValue(max, props.format, ctx),
                  })}
            </text>
          ) : null}
          <text x={cx - r} y={cy + 20} textAnchor="middle" className="odd-tick">
            {formatValue(0, props.format, ctx)}
          </text>
          <text x={cx + r} y={cy + 20} textAnchor="middle" className="odd-tick">
            {formatValue(max, props.format, ctx)}
          </text>
        </svg>
      ) : null}
    </div>
  )
}

/** One value against its scale or a target — completion, utilisation, a rate. */
function GaugePanel(props: GaugeProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Gauge" state={state} defaultHeight={240}>
      {(run) => <Meter run={run} props={props} />}
    </PanelFrame>
  )
}

export const Gauge = editable('Gauge', GaugePanel)
