import {
  boundsOf,
  collectionPoints,
  featureCentre,
  featurePath,
  fitProjection,
  normaliseKey,
  rings,
} from './geo.js'

const square = {
  type: 'Polygon',
  coordinates: [
    [
      [120, 22],
      [122, 22],
      [122, 25],
      [120, 25],
      [120, 22],
    ],
  ],
}
const multi = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [120, 22],
        [121, 22],
        [121, 23],
        [120, 22],
      ],
    ],
    [
      [
        [118, 24],
        [118.5, 24],
        [118.5, 24.5],
        [118, 24],
      ],
    ],
  ],
}

describe('geo', () => {
  it('reads rings from polygons and multipolygons, ignoring other geometry', () => {
    expect(rings(square)).toHaveLength(1)
    expect(rings(multi)).toHaveLength(2)
    expect(rings({ type: 'Point', coordinates: [1, 2] })).toEqual([])
    expect(rings(null)).toEqual([])
  })

  it('bounds a collection', () => {
    const bounds = boundsOf(
      collectionPoints({ features: [{ geometry: square }, { geometry: multi }] }),
    )
    expect(bounds).toEqual({ minLng: 118, maxLng: 122, minLat: 22, maxLat: 25 })
  })

  it('fits the bounds inside the box, north up, keeping proportions', () => {
    const project = fitProjection(
      { minLng: 120, maxLng: 122, minLat: 22, maxLat: 25 },
      400,
      300,
      10,
    )
    const [x0, y0] = project(120, 25)
    const [x1, y1] = project(122, 22)
    expect(y0).toBeLessThan(y1)
    expect(x0).toBeLessThan(x1)
    for (const v of [x0, x1]) expect(v).toBeGreaterThanOrEqual(10 - 1e-9)
    for (const v of [x0, x1]) expect(v).toBeLessThanOrEqual(390 + 1e-9)
    for (const v of [y0, y1]) expect(v).toBeGreaterThanOrEqual(10 - 1e-9)
    for (const v of [y0, y1]) expect(v).toBeLessThanOrEqual(290 + 1e-9)
    const k = Math.cos(23.5 * (Math.PI / 180))
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo((2 * k) / 3, 6)
  })

  it('writes closed SVG paths and finds a label point on the largest ring', () => {
    const project = fitProjection({ minLng: 118, maxLng: 122, minLat: 22, maxLat: 25 }, 400, 300)
    expect(featurePath(multi, project).match(/Z/g)).toHaveLength(2)
    expect(featureCentre(multi)).toEqual([120.5, 22.5])
  })

  it('normalises keys for matching', () => {
    expect(normaliseKey(' 台北市 ')).toBe(normaliseKey('臺北市'))
    expect(normaliseKey('Taipei')).toBe('taipei')
  })
})
