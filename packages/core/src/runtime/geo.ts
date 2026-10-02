export type Position = [number, number]

export interface GeoGeometry {
  type: 'Polygon' | 'MultiPolygon' | string
  coordinates: unknown
}

// `type` is a plain string because `import geo from './x.json'` widens the
// literal: a typed 'FeatureCollection' would reject every imported file.
export interface GeoFeature {
  type?: string
  properties?: Record<string, unknown> | null
  geometry: GeoGeometry | null
}

export interface GeoCollection {
  type?: string
  features: GeoFeature[]
}

export interface Bounds {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
}

/** Every ring of a Polygon or MultiPolygon, as [lng, lat] lists. Other geometry types are ignored. */
export function rings(geometry: GeoGeometry | null | undefined): Position[][] {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return (geometry.coordinates as Position[][]) ?? []
  if (geometry.type === 'MultiPolygon')
    return ((geometry.coordinates as Position[][][]) ?? []).flat()
  return []
}

export function isCollection(value: unknown): value is GeoCollection {
  return (
    Boolean(value) && typeof value === 'object' && Array.isArray((value as GeoCollection).features)
  )
}

export function boundsOf(points: Iterable<Position>): Bounds | undefined {
  let b: Bounds | undefined
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (!b) b = { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat }
    else {
      b.minLng = Math.min(b.minLng, lng)
      b.maxLng = Math.max(b.maxLng, lng)
      b.minLat = Math.min(b.minLat, lat)
      b.maxLat = Math.max(b.maxLat, lat)
    }
  }
  return b
}

export function* collectionPoints(collection: GeoCollection | undefined): Generator<Position> {
  if (!collection) return
  for (const feature of collection.features) {
    for (const ring of rings(feature.geometry)) yield* ring
  }
}

export interface Projection {
  (lng: number, lat: number): Position
  scale: number
}

/**
 * Equirectangular, with longitude shrunk by cos(mid-latitude) so shapes keep
 * their proportions at the latitude being shown — enough for a country or a
 * region, and nothing to install. Fitted to the box with `padding` on all sides.
 */
export function fitProjection(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 12,
): Projection {
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * (Math.PI / 180)
  const k = Math.cos(midLat)
  const spanX = Math.max((bounds.maxLng - bounds.minLng) * k, 1e-9)
  const spanY = Math.max(bounds.maxLat - bounds.minLat, 1e-9)
  const innerW = Math.max(1, width - padding * 2)
  const innerH = Math.max(1, height - padding * 2)
  const scale = Math.min(innerW / spanX, innerH / spanY)
  const offsetX = padding + (innerW - spanX * scale) / 2
  const offsetY = padding + (innerH - spanY * scale) / 2
  const project = ((lng: number, lat: number): Position => [
    offsetX + (lng - bounds.minLng) * k * scale,
    offsetY + (bounds.maxLat - lat) * scale,
  ]) as Projection
  project.scale = scale
  return project
}

/** An SVG path for a feature's polygons, rings closed, holes kept (use fill-rule evenodd). */
export function featurePath(geometry: GeoGeometry | null | undefined, project: Projection): string {
  let d = ''
  for (const ring of rings(geometry)) {
    ring.forEach(([lng, lat], i) => {
      const [x, y] = project(lng, lat)
      d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    if (ring.length) d += 'Z'
  }
  return d
}

/** A label point: the centre of the feature's largest ring's bounding box. */
export function featureCentre(geometry: GeoGeometry | null | undefined): Position | undefined {
  let best: Bounds | undefined
  let bestArea = -1
  for (const ring of rings(geometry)) {
    const b = boundsOf(ring)
    if (!b) continue
    const area = (b.maxLng - b.minLng) * (b.maxLat - b.minLat)
    if (area > bestArea) {
      best = b
      bestArea = area
    }
  }
  return best ? [(best.minLng + best.maxLng) / 2, (best.minLat + best.maxLat) / 2] : undefined
}

export function normaliseKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replaceAll('台', '臺')
    .toLowerCase()
}
