import { squarify } from './squarify.js'

describe('squarify', () => {
  it('fills the box exactly, areas proportional to size', () => {
    const tiles = squarify(
      [6, 6, 4, 3, 2, 2, 1].map((size, i) => ({ item: i, size })),
      600,
      400,
    )
    const area = tiles.reduce((sum, t) => sum + t.w * t.h, 0)
    expect(area).toBeCloseTo(600 * 400, 3)
    expect(tiles[0]!.w * tiles[0]!.h).toBeCloseTo((6 / 24) * 600 * 400, 3)
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9)
      expect(t.x + t.w).toBeLessThanOrEqual(600 + 1e-6)
      expect(t.y + t.h).toBeLessThanOrEqual(400 + 1e-6)
    }
  })

  it('keeps tiles reasonably square', () => {
    const tiles = squarify(
      Array.from({ length: 12 }, (_, i) => ({ item: i, size: 12 - i })),
      800,
      400,
    )
    const ratios = tiles.map((t) => Math.max(t.w / t.h, t.h / t.w))
    expect(Math.max(...ratios)).toBeLessThan(4)
  })
})
