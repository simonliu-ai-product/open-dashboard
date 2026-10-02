import { linkPath, SankeyCycleError, sankeyLayout } from './sankey.js'

const links = [
  { source: 'organic', target: 'Beans', value: 60 },
  { source: 'organic', target: 'Grinders', value: 20 },
  { source: 'social', target: 'Beans', value: 30 },
  { source: 'Beans', target: 'repeat', value: 50 },
  { source: 'Grinders', target: 'repeat', value: 5 },
]

describe('sankeyLayout', () => {
  it('places nodes in columns by longest path', () => {
    const { nodes } = sankeyLayout(links, 600, 300)
    const col = Object.fromEntries(nodes.map((n) => [n.name, n.column]))
    expect(col).toEqual({ organic: 0, social: 0, Beans: 1, Grinders: 1, repeat: 2 })
    expect(nodes.find((n) => n.name === 'repeat')?.x1).toBeCloseTo(600)
  })

  it('sizes nodes by flow and keeps them inside the box without overlap', () => {
    const { nodes } = sankeyLayout(links, 600, 300)
    const beans = nodes.find((n) => n.name === 'Beans')!
    expect(beans.value).toBe(90)
    for (const c of [0, 1, 2]) {
      const col = nodes.filter((n) => n.column === c).sort((a, b) => a.y0 - b.y0)
      for (const n of col) {
        expect(n.y0).toBeGreaterThanOrEqual(-1e-6)
        expect(n.y1).toBeLessThanOrEqual(300 + 1e-6)
      }
      for (let i = 1; i < col.length; i += 1)
        expect(col[i]!.y0).toBeGreaterThanOrEqual(col[i - 1]!.y1 - 1e-6)
    }
  })

  it('merges duplicate links and stacks bands within each node', () => {
    const { links: out } = sankeyLayout(
      [...links, { source: 'organic', target: 'Beans', value: 10 }],
      600,
      300,
    )
    const organicBeans = out.filter((l) => l.source.name === 'organic' && l.target.name === 'Beans')
    expect(organicBeans).toHaveLength(1)
    expect(organicBeans[0]?.value).toBe(70)
    const fromOrganic = out.filter((l) => l.source.name === 'organic')
    const total = fromOrganic.reduce((s, l) => s + l.width, 0)
    const node = fromOrganic[0]!.source
    expect(total).toBeCloseTo(node.y1 - node.y0)
    expect(linkPath(out[0]!)).toMatch(/^M.+C.+L.+C.+Z$/)
  })

  it('gives slots to the eight largest nodes only', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      source: `s${i}`,
      target: 't',
      value: i + 1,
    }))
    const { nodes } = sankeyLayout(many, 400, 400)
    expect(nodes.filter((n) => n.slot >= 0)).toHaveLength(8)
    expect(nodes.find((n) => n.name === 's0')?.slot).toBe(-1)
  })

  it('refuses cycles', () => {
    expect(() =>
      sankeyLayout(
        [
          { source: 'a', target: 'b', value: 1 },
          { source: 'b', target: 'a', value: 1 },
        ],
        100,
        100,
      ),
    ).toThrow(SankeyCycleError)
  })
})
