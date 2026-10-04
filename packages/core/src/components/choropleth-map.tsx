import { useMemo, useState } from 'react'
import { diverging, sequential } from '../runtime/color.js'
import { formatValue, tickFormatter } from '../runtime/format.js'
import {
  boundsOf,
  collectionPoints,
  featurePath,
  fitProjection,
  type GeoCollection,
  isCollection,
  normaliseKey,
} from '../runtime/geo.js'
import { useT } from '../runtime/i18n.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'
import { ChartTooltip } from './tooltip.js'

export interface ChoroplethMapProps extends PanelProps {
  query: string
  /** GeoJSON FeatureCollection of Polygon / MultiPolygon features, imported by the dashboard. */
  geo: GeoCollection
  /** The feature property that names each region, e.g. 'COUNTYNAME'. */
  featureKey: string
  /**
   * The result column holding the same names. Not `key`: React keeps that
   * prop for itself and the component would never see it.
   */
  region: string
  value: string
  format?: Format
  /** 'diverging' for signed values (growth, variance): red below zero, blue above. */
  scale?: 'sequential' | 'diverging'
}

function Regions({ run, props }: { run: QueryRun; props: ChoroplethMapProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const [ref, size] = useSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const geo = isCollection(props.geo) ? props.geo : undefined

  const values = useMemo(() => {
    const out = new Map<string, { key: unknown; value: number }>()
    for (const row of run.result.rows) {
      const n = Number(row[props.value])
      if (Number.isFinite(n))
        out.set(normaliseKey(row[props.region]), { key: row[props.region], value: n })
    }
    return out
  }, [run, props.region, props.value])

  if (!geo)
    return (
      <div className="odd-panel-message">{t('A map needs GeoJSON features passed as geo.')}</div>
    )
  const bounds = boundsOf(collectionPoints(geo))
  if (!bounds)
    return <div className="odd-panel-message">{t('The GeoJSON has no polygons to draw.')}</div>

  const numbers = [...values.values()].map((v) => v.value)
  // The colours span the data, not zero to max: county temperatures of 28–32 °C
  // drawn from 0 would all be the same blue. The legend shows the range used.
  const low = Math.min(...numbers)
  const high = Math.max(...numbers)
  const min = Number.isFinite(low) ? (low === high ? Math.min(0, low) : low) : 0
  const max = Number.isFinite(high) ? (low === high && high === 0 ? 1e-9 : high) : 1e-9
  const polar = props.scale === 'diverging'
  const extent = Math.max(Math.abs(min), Math.abs(max), 1e-9)
  const colour = (n: number) =>
    polar ? diverging(n / extent) : sequential(0.15 + (0.85 * (n - min)) / (max - min || 1))
  const project = fitProjection(bounds, size.width, size.height, 8)
  const ticks = tickFormatter([polar ? -extent : min, polar ? extent : max], props.format, ctx)

  const active = hover === null ? undefined : geo.features[hover]
  const activeKey = active?.properties?.[props.featureKey]
  const activeValue = activeKey === undefined ? undefined : values.get(normaliseKey(activeKey))
  return (
    <div className="odd-chart">
      <div className="odd-plot" ref={ref}>
        {size.width > 0 ? (
          <svg
            width={size.width}
            height={size.height}
            role="img"
            aria-label={`${props.title}: ${humanize(props.value)} by ${humanize(props.region)}`}
          >
            {geo.features.map((feature, i) => {
              const name = feature.properties?.[props.featureKey]
              const datum = values.get(normaliseKey(name))
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: hover and a pointer shortcut; the filter's own <select> is the keyboard path
                <path
                  // biome-ignore lint/suspicious/noArrayIndexKey: features may share or lack names
                  key={i}
                  d={featurePath(feature.geometry, project)}
                  fill={datum ? colour(datum.value) : 'var(--odd-hover)'}
                  fillRule="evenodd"
                  className={drill && datum ? 'odd-region odd-drillable' : 'odd-region'}
                  data-dim={
                    (hover !== null && hover !== i) ||
                    (drill?.anyActive && !drill.isActive(datum?.key))
                      ? ''
                      : undefined
                  }
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onClick={drill && datum ? () => drill.pick(datum.key) : undefined}
                />
              )
            })}
          </svg>
        ) : null}
        {active ? (
          <ChartTooltip
            left={size.width / 2}
            top={8}
            width={size.width}
            title={String(activeKey ?? '—')}
            rows={[
              {
                label: humanize(props.value),
                value: activeValue
                  ? formatValue(activeValue.value, props.format, ctx)
                  : t('No data'),
              },
            ]}
          />
        ) : null}
      </div>
      <div className="odd-scale" aria-hidden="true">
        <span>{ticks(polar ? -extent : min)}</span>
        <span
          className="odd-scale-bar"
          style={{
            background: polar
              ? `linear-gradient(to right, ${diverging(-1)}, ${diverging(0)}, ${diverging(1)})`
              : `linear-gradient(to right, ${sequential(0.15)}, ${sequential(0.575)}, ${sequential(1)})`,
          }}
        />
        <span>{ticks(polar ? extent : max)}</span>
      </div>
    </div>
  )
}

/** Regions shaded by a value — the GeoJSON comes from the dashboard, never from the framework. */
function ChoroplethMapPanel(props: ChoroplethMapProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="ChoroplethMap" state={state} defaultHeight={380}>
      {(run) => <Regions run={run} props={props} />}
    </PanelFrame>
  )
}

export const ChoroplethMap = editable('ChoroplethMap', ChoroplethMapPanel)
