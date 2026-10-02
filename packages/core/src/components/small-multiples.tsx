import { useState } from 'react'
import { POSITIVE } from '../runtime/color.js'
import { formatCategory, formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { linear, niceDomain } from '../runtime/scale.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { textWidth } from './row-chart-kit.js'
import { ChartTooltip } from './tooltip.js'

export interface SmallMultiplesProps extends PanelProps {
  query: string
  /** The time or category column, shared by every facet. */
  x: string
  /** The measure. */
  y: string
  /** One facet per value of this column. */
  series: string
  kind?: 'line' | 'area' | 'bar'
  /** Each facet gets its own y scale. Default false: one scale, so facets compare directly. */
  independent?: boolean
  format?: Format
}

const MAX_FACETS = 24
const MIN_WIDTH = 150

interface Facet {
  name: string
  values: (number | null)[]
}

function Facets({ run, props }: { run: QueryRun; props: SmallMultiplesProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ facet: number; index: number } | null>(null)
  const { rows } = run.result
  const categories: unknown[] = []
  const position = new Map<string, number>()
  const facets: Facet[] = []
  const byName = new Map<string, Facet>()
  for (const row of rows) {
    const key = String(row[props.x])
    if (!position.has(key)) {
      position.set(key, categories.length)
      categories.push(row[props.x])
    }
  }
  for (const row of rows) {
    const name =
      row[props.series] === null || row[props.series] === undefined
        ? '—'
        : String(row[props.series])
    let facet = byName.get(name)
    if (!facet) {
      facet = { name, values: categories.map(() => null) }
      byName.set(name, facet)
      facets.push(facet)
    }
    const n = Number(row[props.y])
    const i = position.get(String(row[props.x])) as number
    if (Number.isFinite(n)) facet.values[i] = (facet.values[i] ?? 0) + n
  }
  if (facets.length === 0 || categories.length === 0) {
    return (
      <div className="odd-panel-message">{t('Small multiples need x, y and a series column.')}</div>
    )
  }
  const dropped = Math.max(0, facets.length - MAX_FACETS)
  const shown = facets.slice(0, MAX_FACETS)
  const kind = props.kind ?? 'line'
  const columns = Math.max(
    1,
    Math.min(shown.length, Math.floor((size.width + 12) / (MIN_WIDTH + 12))),
  )
  const rowsCount = Math.ceil(shown.length / columns)
  const noteHeight = dropped ? 18 : 0
  const fw = (size.width - (columns - 1) * 12) / columns
  const fh = Math.max(60, (size.height - noteHeight - (rowsCount - 1) * 12) / rowsCount)
  const all = shown.flatMap((f) => f.values.filter((v): v is number => v !== null))
  const shared = niceDomain(all, 3, true)

  return (
    <div className="odd-chart">
      <div
        className="odd-multiples"
        ref={ref}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {size.width > 0
          ? shown.map((facet, f) => {
              const domain = props.independent
                ? niceDomain(
                    facet.values.filter((v): v is number => v !== null),
                    3,
                    true,
                  )
                : shared
              const tick = tickFormatter(domain.ticks, props.format, ctx)
              const margin = {
                top: 22,
                right: 6,
                bottom: 18,
                left: Math.max(...domain.ticks.map((v) => textWidth(tick(v)) + 8), 22),
              }
              const w = Math.max(0, fw - margin.left - margin.right)
              const h = Math.max(0, fh - margin.top - margin.bottom)
              const n = categories.length
              const band = w / Math.max(1, n)
              const cx = (i: number) =>
                kind === 'bar'
                  ? margin.left + band * (i + 0.5)
                  : margin.left + (n === 1 ? w / 2 : (i / (n - 1)) * w)
              const cy = linear([domain.min, domain.max], [margin.top + h, margin.top])
              const segments: [number, number][][] = []
              let current: [number, number][] = []
              facet.values.forEach((v, i) => {
                if (v === null) {
                  if (current.length) segments.push(current)
                  current = []
                } else current.push([cx(i), cy(v)])
              })
              if (current.length) segments.push(current)
              const base = cy(Math.max(domain.min, Math.min(domain.max, 0)))
              const active = hover?.facet === f ? hover.index : null
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: a pointer shortcut; the filter's own <select> is the keyboard path
                <figure
                  key={facet.name}
                  className={drill ? 'odd-facet odd-drillable' : 'odd-facet'}
                  style={{ height: fh }}
                  onClick={drill ? () => drill.pick(facet.name) : undefined}
                  data-dim={drill?.anyActive && !drill.isActive(facet.name) ? '' : undefined}
                >
                  <figcaption>{facet.name}</figcaption>
                  <svg
                    width={fw}
                    height={fh}
                    role="img"
                    aria-label={`${facet.name}: ${props.y}`}
                    onPointerMove={(event) => {
                      const box = event.currentTarget.getBoundingClientRect()
                      const px = event.clientX - box.left - margin.left
                      const index =
                        kind === 'bar'
                          ? Math.floor(px / band)
                          : Math.round(n === 1 ? 0 : (px / Math.max(1, w)) * (n - 1))
                      setHover({ facet: f, index: Math.max(0, Math.min(n - 1, index)) })
                    }}
                    onPointerLeave={() => setHover(null)}
                  >
                    {domain.ticks.length > 1
                      ? [
                          domain.ticks[0] as number,
                          domain.ticks[domain.ticks.length - 1] as number,
                        ].map((v) => (
                          <g key={v}>
                            <line
                              x1={margin.left}
                              x2={margin.left + w}
                              y1={cy(v)}
                              y2={cy(v)}
                              className={v === 0 ? 'odd-baseline' : 'odd-grid-line'}
                            />
                            <text
                              x={margin.left - 4}
                              y={cy(v)}
                              dy="0.32em"
                              textAnchor="end"
                              className="odd-tick"
                            >
                              {tick(v)}
                            </text>
                          </g>
                        ))
                      : null}
                    {kind === 'bar'
                      ? facet.values.map((v, i) => {
                          if (v === null) return null
                          const thickness = Math.max(1, Math.min(24, band * 0.7))
                          const a = cy(Math.max(0, v))
                          const b = cy(Math.min(0, v))
                          return (
                            <rect
                              // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
                              key={i}
                              x={cx(i) - thickness / 2}
                              y={a}
                              width={thickness}
                              height={Math.max(0, b - a)}
                              rx={Math.min(2, thickness / 3)}
                              fill={POSITIVE}
                              className="odd-bar"
                              data-dim={active !== null && active !== i ? '' : undefined}
                            />
                          )
                        })
                      : segments.map((points) => {
                          const line = points
                            .map(
                              ([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`,
                            )
                            .join('')
                          const first = points[0] as [number, number]
                          const last = points[points.length - 1] as [number, number]
                          return (
                            <g key={line}>
                              {kind === 'area' ? (
                                <path
                                  d={`${line}L${last[0]},${base}L${first[0]},${base}Z`}
                                  fill={POSITIVE}
                                  className="odd-area"
                                />
                              ) : null}
                              <path d={line} stroke={POSITIVE} className="odd-line" />
                            </g>
                          )
                        })}
                    {active !== null && kind !== 'bar' && facet.values[active] !== null ? (
                      <circle
                        cx={cx(active)}
                        cy={cy(facet.values[active] as number)}
                        r={4}
                        fill={POSITIVE}
                        className="odd-dot"
                      />
                    ) : null}
                    <text x={margin.left} y={fh - 4} className="odd-tick">
                      {formatCategory(categories[0], ctx, 10)}
                    </text>
                    {/* The end label only when it clears the start one. */}
                    {textWidth(formatCategory(categories[0], ctx, 10)) +
                      textWidth(formatCategory(categories[n - 1], ctx, 10)) +
                      8 <=
                    w ? (
                      <text x={margin.left + w} y={fh - 4} textAnchor="end" className="odd-tick">
                        {formatCategory(categories[n - 1], ctx, 10)}
                      </text>
                    ) : null}
                  </svg>
                  {active !== null ? (
                    <ChartTooltip
                      left={cx(active)}
                      top={20}
                      width={fw}
                      title={formatValue(categories[active], undefined, ctx)}
                      rows={[
                        {
                          label: facet.name,
                          value: formatValue(facet.values[active] ?? null, props.format, ctx),
                        },
                      ]}
                    />
                  ) : null}
                </figure>
              )
            })
          : null}
      </div>
      {dropped ? (
        <p className="odd-multiples-note">
          {t('{n} more not shown — filter or aggregate to see them', { n: dropped })}
        </p>
      ) : null}
    </div>
  )
}

/** One small chart per series on a shared scale — instead of many tangled lines in one. */
function SmallMultiplesPanel(props: SmallMultiplesProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="SmallMultiples" state={state} defaultHeight={400}>
      {(run) => <Facets run={run} props={props} />}
    </PanelFrame>
  )
}

export const SmallMultiples = editable('SmallMultiples', SmallMultiplesPanel)
