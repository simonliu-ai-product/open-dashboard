import { useState } from 'react'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { pickX, pickY } from '../runtime/shape.js'
import { squarify } from '../runtime/squarify.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { ChartTooltip } from './tooltip.js'

export interface TreemapProps extends PanelProps {
  query: string
  /** The tile names. Default: the first text column. */
  label?: string
  /** The tile sizes. Default: the first numeric column. */
  value?: string
  format?: Format
  /** Tiles beyond this many are summed into "Other". Default 12. */
  maxItems?: number
  /**
   * A column grouping the tiles (product → category): one colour per group, in
   * a legend. Without it every tile shares one colour — tile identity is the
   * label, and a colour per tile would run out after eight.
   */
  group?: string
}

interface Item {
  name: string
  n: number
  slot: number
  group: string
  other: boolean
}

/** Share of a whole across many parts — where a pie runs out of slices. */
function Tiles({ run, props }: { run: QueryRun; props: TreemapProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const { columns, rows } = run.result
  const label = pickX(columns, props.label)
  const value = pickY(columns, label, props.value)[0]
  if (!label || !value)
    return (
      <div className="odd-panel-message">
        {t('Needs a label column and a numeric value column.')}
      </div>
    )

  const limit = Math.max(2, props.maxItems ?? 12)
  let items: Item[] = rows
    .map((row) => ({
      name: String(row[label] ?? '—'),
      n: Number(row[value]),
      slot: 1,
      group: props.group ? String(row[props.group] ?? '—') : '',
      other: false,
    }))
    .filter((i) => Number.isFinite(i.n) && i.n > 0)
    .sort((a, b) => b.n - a.n)
  if (items.length > limit) {
    const rest = items.slice(limit - 1).reduce((sum, i) => sum + i.n, 0)
    items = [
      ...items.slice(0, limit - 1),
      { name: t('Other'), n: rest, slot: 0, group: '', other: true },
    ]
  }
  const groups: string[] = []
  if (props.group) {
    for (const item of items) {
      if (!item.other && !groups.includes(item.group) && groups.length < 8) groups.push(item.group)
    }
  }
  for (const item of items) {
    if (item.other) item.slot = 0
    else if (props.group)
      item.slot = groups.includes(item.group) ? groups.indexOf(item.group) + 1 : 0
  }
  const total = items.reduce((sum, i) => sum + i.n, 0)
  const tiles = squarify(
    items.map((item) => ({ item, size: item.n })),
    size.width,
    size.height,
  )
  const active = tiles.find((tile) => tile.item.name === hover)

  return (
    <div className="odd-chart">
      {groups.length > 1 ? (
        <ul className="odd-legend">
          {groups.map((name, i) => (
            <li key={name}>
              <span
                className="odd-key odd-key-box"
                style={{ background: `var(--odd-series-${i + 1})` }}
              />
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="odd-treemap" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: share by ${label}`}
          >
            {tiles.map(({ item, x, y, w, h }) => {
              const roomy = w > 64 && h > 34
              const fill =
                item.slot === 0 ? 'var(--odd-surface-2)' : `var(--odd-series-${item.slot})`
              const ink =
                item.slot === 0 ? 'var(--odd-ink-2)' : `var(--odd-series-${item.slot}-ink)`
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                <g
                  key={item.name}
                  onPointerEnter={() => setHover(item.name)}
                  onPointerLeave={() => setHover(null)}
                  onClick={drill && !item.other ? () => drill.pick(item.name) : undefined}
                  className={drill && !item.other ? 'odd-drillable' : undefined}
                  data-dim={
                    (hover !== null && hover !== item.name) ||
                    (drill?.anyActive && !drill.isActive(item.name))
                      ? ''
                      : undefined
                  }
                >
                  <rect
                    x={x + 1}
                    y={y + 1}
                    width={Math.max(0, w - 2)}
                    height={Math.max(0, h - 2)}
                    rx={4}
                    fill={fill}
                    className="odd-tile"
                  />
                  {roomy ? (
                    <>
                      <text x={x + 9} y={y + 19} fill={ink} className="odd-tile-label">
                        {item.name.length * 7 > w - 16
                          ? `${item.name.slice(0, Math.max(1, Math.floor((w - 24) / 7)))}…`
                          : item.name}
                      </text>
                      {h > 50 ? (
                        <text x={x + 9} y={y + 37} fill={ink} className="odd-tile-value">
                          {formatValue(item.n / total, 'percent', ctx)}
                        </text>
                      ) : null}
                    </>
                  ) : null}
                </g>
              )
            })}
          </svg>
        ) : null}
        {active ? (
          <ChartTooltip
            left={active.x + active.w / 2}
            top={Math.max(0, active.y + 6)}
            width={size.width}
            title={active.item.name}
            rows={[
              { label: t('Value'), value: formatValue(active.item.n, props.format, ctx) },
              { label: t('Share'), value: formatValue(active.item.n / total, 'percent', ctx) },
              ...(props.group ? [{ label: t('Group'), value: active.item.group }] : []),
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

function TreemapPanel(props: TreemapProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="Treemap" state={state} defaultHeight={320}>
      {(run) => <Tiles run={run} props={props} />}
    </PanelFrame>
  )
}

export const Treemap = editable('Treemap', TreemapPanel)
