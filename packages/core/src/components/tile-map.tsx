import { useState } from 'react'
import { sequential } from '../runtime/color.js'
import { formatValue, tickFormatter } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { humanize } from '../runtime/shape.js'
import { type GridSpec, gridCells, placeKeys, taiwanTile } from '../runtime/tile-grid.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { ChartTooltip } from './tooltip.js'

export interface TileMapProps extends PanelProps {
  query: string
  /**
   * The column naming each place — 臺北市, 台北, Taipei, New Taipei City… Not
   * `key`: React keeps that prop for itself.
   */
  region: string
  value: string
  format?: Format
  /** 'taiwan' (default): the 22 counties and cities. Or your own `{ name: [col, row] }`. */
  grid?: GridSpec
}

interface Cell {
  key: string | undefined
  label: string
  col: number
  row: number
  value: number | undefined
}

const GAP = 4

/**
 * Places as equal squares in roughly their real arrangement: a map where a
 * small, dense city counts as much as a large, empty county.
 */
function Tiles({ run, props }: { run: QueryRun; props: TileMapProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const grid = props.grid ?? 'taiwan'

  const values = new Map<string, number>()
  for (const row of run.result.rows) {
    const n = Number(row[props.value])
    if (Number.isFinite(n))
      values.set(
        String(row[props.region] ?? ''),
        (values.get(String(row[props.region] ?? '')) ?? 0) + n,
      )
  }
  const { placed, unmatched } = placeKeys([...values.keys()], grid)

  const cells: Cell[] = gridCells(grid).map(({ name, col, row }) => {
    const owner = [...placed.values()].find((p) => p.col === col && p.row === row)
    return {
      key: owner?.key,
      label: owner?.short ?? (grid === 'taiwan' ? (taiwanTile(name)?.short ?? name) : name),
      col,
      row,
      value: owner ? values.get(owner.key) : undefined,
    }
  })
  const numbers = cells.map((c) => c.value).filter((v): v is number => v !== undefined)
  if (numbers.length === 0) {
    return <div className="odd-panel-message">{t('No rows matched a place on the map.')}</div>
  }
  const min = Math.min(0, ...numbers)
  const max = Math.max(...numbers, 1e-9)
  const cols = Math.max(...cells.map((c) => c.col)) + 1
  const rows = Math.max(...cells.map((c) => c.row)) + 1
  const side = Math.max(0, Math.min((size.width - GAP) / cols, (size.height - GAP) / rows))
  const left = (size.width - side * cols) / 2
  const top = (size.height - side * rows) / 2
  const ticks = tickFormatter([min, max], props.format, ctx)
  const active = cells.find((c) => `${c.col},${c.row}` === hover)

  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 && side > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${humanize(props.value)} by ${humanize(props.region)}`}
          >
            {cells.map((cell) => {
              const id = `${cell.col},${cell.row}`
              const share =
                cell.value === undefined ? undefined : (cell.value - min) / (max - min || 1)
              const x = left + cell.col * side
              const y = top + cell.row * side
              const ink =
                share === undefined
                  ? 'var(--odd-muted)'
                  : share >= 0.6
                    ? 'var(--odd-series-1-ink)'
                    : 'var(--odd-ink)'
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                <g
                  key={id}
                  onPointerEnter={() => setHover(id)}
                  onPointerLeave={() => setHover(null)}
                  onClick={drill && cell.key ? () => drill.pick(cell.key) : undefined}
                  className={drill && cell.key ? 'odd-drillable' : undefined}
                  data-dim={
                    (hover !== null && hover !== id) ||
                    (drill?.anyActive && !drill.isActive(cell.key))
                      ? ''
                      : undefined
                  }
                >
                  <rect
                    x={x + GAP / 2}
                    y={y + GAP / 2}
                    width={side - GAP}
                    height={side - GAP}
                    rx={Math.min(6, side / 8)}
                    fill={share === undefined ? 'var(--odd-hover)' : sequential(share)}
                    className="odd-tile"
                  />
                  {side >= 30 ? (
                    <text
                      x={x + side / 2}
                      y={y + side / 2 - (side >= 46 ? 5 : 0)}
                      textAnchor="middle"
                      dy="0.35em"
                      fill={ink}
                      className="odd-tile-map-label"
                    >
                      {cell.label}
                    </text>
                  ) : null}
                  {side >= 46 && cell.value !== undefined ? (
                    <text
                      x={x + side / 2}
                      y={y + side / 2 + 11}
                      textAnchor="middle"
                      dy="0.35em"
                      fill={ink}
                      className="odd-tile-map-value"
                    >
                      {ticks(cell.value)}
                    </text>
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : null}
        {active ? (
          <ChartTooltip
            left={left + (active.col + 0.5) * side}
            top={Math.max(0, top + active.row * side - 30)}
            width={size.width}
            title={active.key ?? active.label}
            rows={[
              {
                label: humanize(props.value),
                value:
                  active.value === undefined
                    ? t('No data')
                    : formatValue(active.value, props.format, ctx),
              },
            ]}
          />
        ) : null}
      </div>
      <div className="odd-scale" aria-hidden="true">
        {unmatched.length ? (
          <span className="odd-map-note" title={unmatched.join(', ')}>
            {t('Not on the map: {names}', {
              names: unmatched.slice(0, 3).join(', ') + (unmatched.length > 3 ? '…' : ''),
            })}
          </span>
        ) : null}
        <span>{ticks(min)}</span>
        <span
          className="odd-scale-bar"
          style={{
            background: `linear-gradient(to right, ${sequential(0)}, ${sequential(0.5)}, ${sequential(1)})`,
          }}
        />
        <span>{ticks(max)}</span>
      </div>
    </div>
  )
}

function TileMapPanel(props: TileMapProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="TileMap" state={state} defaultHeight={420}>
      {(run) => <Tiles run={run} props={props} />}
    </PanelFrame>
  )
}

export const TileMap = editable('TileMap', TileMapPanel)
