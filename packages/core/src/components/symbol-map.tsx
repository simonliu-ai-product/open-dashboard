import { useState } from 'react'
import { seriesColor } from '../runtime/color.js'
import { formatValue } from '../runtime/format.js'
import {
  boundsOf,
  collectionPoints,
  featurePath,
  fitProjection,
  type GeoCollection,
  isCollection,
  type Position,
} from '../runtime/geo.js'
import { useT } from '../runtime/i18n.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { ChartTooltip } from './tooltip.js'

export interface SymbolMapProps extends PanelProps {
  query: string
  lat: string
  lng: string
  /** A numeric column: circle area in proportion to it. */
  size?: string
  /** Names each point in the tooltip (and for drill). */
  label?: string
  /** Colours points by group, up to eight, with a legend. */
  series?: string
  format?: Format
  /** Optional GeoJSON outline drawn underneath, imported by the dashboard. */
  geo?: GeoCollection
}

interface Point {
  lng: number
  lat: number
  size: number | null
  label: string
  group: number
}

const MAX_GROUPS = 8

function Points({ run, props }: { run: QueryRun; props: SymbolMapProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, box] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const groups: string[] = []
  let overflow = false
  const points: Point[] = []
  for (const row of run.result.rows) {
    const lat = Number(row[props.lat])
    const lng = Number(row[props.lng])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    let group = 0
    if (props.series) {
      const name = String(row[props.series] ?? '—')
      group = groups.indexOf(name)
      if (group === -1) {
        if (groups.length < MAX_GROUPS - 1) {
          groups.push(name)
          group = groups.length - 1
        } else {
          overflow = true
          group = MAX_GROUPS - 1
        }
      }
    }
    const s = props.size ? Number(row[props.size]) : Number.NaN
    points.push({
      lng,
      lat,
      size: Number.isFinite(s) ? s : null,
      label: props.label ? String(row[props.label] ?? '') : '',
      group,
    })
  }
  if (overflow) groups.push(t('Other'))
  if (points.length === 0) {
    return (
      <div className="odd-panel-message">
        {t('A map of points needs numeric lat and lng columns.')}
      </div>
    )
  }

  const outline = isCollection(props.geo) ? props.geo : undefined
  const all: Position[] = [
    ...points.map((p): Position => [p.lng, p.lat]),
    ...collectionPoints(outline),
  ]
  const bounds = boundsOf(all)
  if (!bounds) return null
  const pad = 0.05
  const project = fitProjection(
    {
      minLng: bounds.minLng - (bounds.maxLng - bounds.minLng) * pad - 0.01,
      maxLng: bounds.maxLng + (bounds.maxLng - bounds.minLng) * pad + 0.01,
      minLat: bounds.minLat - (bounds.maxLat - bounds.minLat) * pad - 0.01,
      maxLat: bounds.maxLat + (bounds.maxLat - bounds.minLat) * pad + 0.01,
    },
    box.width,
    box.height,
    16,
  )
  const largest = Math.max(1e-9, ...points.map((p) => p.size ?? 0))
  const radius = (p: Point) =>
    props.size && p.size !== null ? 4 + Math.sqrt(Math.max(0, p.size) / largest) * 18 : 5
  const order = points
    .map((_, i) => i)
    .sort((a, b) => radius(points[b] as Point) - radius(points[a] as Point))
  const active = hover === null ? undefined : points[hover]
  const at = active ? project(active.lng, active.lat) : undefined

  return (
    <div className="odd-chart">
      {groups.length > 1 ? (
        <ul className="odd-legend">
          {groups.map((name, i) => (
            <li key={name}>
              <span
                className="odd-key odd-key-box"
                style={{ background: seriesColor(i), borderRadius: 4 }}
              />
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="odd-plot" ref={ref}>
        {box.width > 0 ? (
          <svg
            width={box.width}
            height={box.height}
            role="img"
            aria-label={`${props.title}: ${points.length} points`}
          >
            {outline?.features.map((feature, i) => (
              <path
                // biome-ignore lint/suspicious/noArrayIndexKey: outline features have no identity of their own
                key={i}
                d={featurePath(feature.geometry, project)}
                fillRule="evenodd"
                className="odd-map-outline"
              />
            ))}
            {order.map((i) => {
              const p = points[i] as Point
              const [x, y] = project(p.lng, p.lat)
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={radius(p)}
                  fill={seriesColor(p.group)}
                  fillOpacity={props.size ? 0.6 : 0.85}
                  className={drill && p.label ? 'odd-dot odd-drillable' : 'odd-dot'}
                  data-dim={
                    (hover !== null && hover !== i) ||
                    (drill?.anyActive && !drill.isActive(p.label))
                      ? ''
                      : undefined
                  }
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onClick={drill && p.label ? () => drill.pick(p.label) : undefined}
                />
              )
            })}
          </svg>
        ) : null}
        {active && at ? (
          <ChartTooltip
            left={at[0]}
            top={Math.max(0, at[1] - 40)}
            width={box.width}
            title={active.label || (props.series ? (groups[active.group] ?? '') : t('Point'))}
            rows={[
              ...(props.series && active.label
                ? [{ label: humanize(props.series), value: groups[active.group] ?? '' }]
                : []),
              ...(props.size && active.size !== null
                ? [
                    {
                      label: humanize(props.size),
                      value: formatValue(active.size, props.format, ctx),
                    },
                  ]
                : []),
              { label: t('Location'), value: `${active.lat.toFixed(3)}, ${active.lng.toFixed(3)}` },
            ]}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Places as points — stores, warehouses, customers — sized by a value, over an optional outline. */
function SymbolMapPanel(props: SymbolMapProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="SymbolMap" state={state} defaultHeight={380}>
      {(run) => <Points run={run} props={props} />}
    </PanelFrame>
  )
}

export const SymbolMap = editable('SymbolMap', SymbolMapPanel)
