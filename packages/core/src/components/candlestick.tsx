import { useState } from 'react'
import { formatCategory, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain, thinIndices } from '../runtime/scale.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface CandlestickProps extends PanelProps {
  query: string
  /** The period: a day, a week. */
  x: string
  open: string
  high: string
  low: string
  close: string
  /**
   * Which colour means rising. 'east' (Taiwan, China, Japan, Korea): red up,
   * green down. 'west': green up, red down. Default follows the locale.
   */
  convention?: 'east' | 'west'
  format?: Format
}

const GOOD = 'var(--odd-good)'
const BAD = 'var(--odd-critical)'

function Candles({ run, props }: { run: QueryRun; props: CandlestickProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const candles = run.result.rows
    .map((row) => ({
      x: row[props.x],
      open: Number(row[props.open]),
      high: Number(row[props.high]),
      low: Number(row[props.low]),
      close: Number(row[props.close]),
    }))
    .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
  if (candles.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('A candlestick chart needs open, high, low and close columns.')}
      </div>
    )
  }
  const east =
    (props.convention ?? (/^(zh|ja|ko)\b/i.test(ctx.locale) ? 'east' : 'west')) === 'east'
  const up = east ? BAD : GOOD
  const down = east ? GOOD : BAD
  const domain = niceDomain(
    candles.flatMap((c) => [c.high, c.low]),
    5,
    false,
  )
  const tick = tickFormatter(domain.ticks, props.format, ctx)
  const margin = {
    top: 8,
    right: 12,
    bottom: 24,
    left: Math.max(...domain.ticks.map((v) => textWidth(tick(v)) + 10), 28),
  }
  const w = Math.max(0, size.width - margin.left - margin.right)
  const h = Math.max(0, size.height - margin.top - margin.bottom)
  const n = candles.length
  const band = w / n
  const body = Math.max(1, Math.min(12, band * 0.7))
  const cx = (i: number) => margin.left + band * (i + 0.5)
  const cy = linear([domain.min, domain.max], [margin.top + h, margin.top])
  const shown = thinIndices(n, Math.max(2, Math.floor(w / 72)))
  const active = hover === null ? undefined : candles[hover]

  return (
    <div className="odd-chart">
      <ul className="odd-legend">
        <li>
          <span className="odd-key odd-key-box" style={{ background: up }} />
          {t('Rising')}
        </li>
        <li>
          <span className="odd-key odd-key-box" style={{ background: down }} />
          {t('Falling')}
        </li>
      </ul>
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${t('candlestick')}`}
            onPointerMove={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const i = Math.floor((event.clientX - box.left - margin.left) / band)
              setHover(i >= 0 && i < n ? i : null)
            }}
            onPointerLeave={() => setHover(null)}
          >
            {domain.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={margin.left}
                  x2={margin.left + w}
                  y1={cy(v)}
                  y2={cy(v)}
                  className="odd-grid-line"
                />
                <text
                  x={margin.left - 6}
                  y={cy(v)}
                  dy="0.32em"
                  textAnchor="end"
                  className="odd-tick"
                >
                  {tick(v)}
                </text>
              </g>
            ))}
            {hover !== null ? (
              <rect
                x={margin.left + band * hover}
                y={margin.top}
                width={band}
                height={h}
                className="odd-hover-band"
              />
            ) : null}
            {candles.map((c, i) => {
              const color = c.close >= c.open ? up : down
              const top = cy(Math.max(c.open, c.close))
              const bottom = cy(Math.min(c.open, c.close))
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: candles are positional
                <g key={i}>
                  <line
                    x1={cx(i)}
                    x2={cx(i)}
                    y1={cy(c.high)}
                    y2={cy(c.low)}
                    stroke={color}
                    strokeWidth={1}
                  />
                  <rect
                    x={cx(i) - body / 2}
                    y={top}
                    width={body}
                    height={Math.max(1, bottom - top)}
                    fill={color}
                  />
                </g>
              )
            })}
            {shown.map((i) => (
              <text
                key={`x${i}`}
                x={cx(i)}
                y={margin.top + h + 16}
                textAnchor="middle"
                className="odd-tick"
              >
                {formatCategory(candles[i]?.x, ctx, 10)}
              </text>
            ))}
          </svg>
        ) : null}
        {active && hover !== null ? (
          <ChartTooltip
            left={cx(hover)}
            top={8}
            width={size.width}
            title={formatValue(active.x, undefined, ctx)}
            rows={[
              { label: t('Open'), value: formatValue(active.open, props.format, ctx) },
              { label: t('High'), value: formatValue(active.high, props.format, ctx) },
              { label: t('Low'), value: formatValue(active.low, props.format, ctx) },
              {
                color: active.close >= active.open ? up : down,
                label: t('Close'),
                value: formatValue(active.close, props.format, ctx),
              },
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Open, high, low and close per period — prices, rates, anything traded. */
function CandlestickPanel(props: CandlestickProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Candlestick" state={state} defaultHeight={320}>
      {(run) => <Candles run={run} props={props} />}
    </PanelFrame>
  )
}

export const Candlestick = editable('Candlestick', CandlestickPanel)
