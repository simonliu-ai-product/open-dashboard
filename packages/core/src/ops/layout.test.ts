import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedConfig } from '../workspace.js'
import { analyzeDashboard, parseSource } from './analyze.js'
import { applyEdits, describeLayout, editLayout, hashSource, readLayout } from './layout.js'

const SOURCE = `import {
  BarChart,
  Dashboard,
  Row,
  Stat,
  Table,
} from '@open-dashboard/core'

const cols = 6

export default function Sales() {
  return (
    <Dashboard>
      <Row>
        <Stat title="Revenue" query="kpis" column="revenue" format="currency" />
        <Stat title="Orders" query="kpis" column="orders" />
      </Row>
      <Row height={320}>
        {/* @dashboard-comment: make this monthly */}
        <BarChart
          title="Top products"
          query="top_products"
          x="product"
          y="revenue"
          format="currency"
          horizontal
          span={5}
        />
        <Table title="Recent orders" query="recent" span={cols} />
      </Row>
    </Dashboard>
  )
}
`

const parses = (code: string) => expect(() => parseSource(code, true)).not.toThrow()

describe('describeLayout', () => {
  it('lists panels with literal props, computed props, and row siblings', () => {
    const { panels, duplicates } = describeLayout(SOURCE)
    expect(duplicates).toEqual([])
    const bar = panels.find((p) => p.title === 'Top products')
    expect(bar).toMatchObject({
      component: 'BarChart',
      props: { x: 'product', y: 'revenue', horizontal: true, span: 5 },
      siblings: ['Top products', 'Recent orders'],
      inRow: true,
      locked: [],
    })
    expect(panels.find((p) => p.title === 'Recent orders')?.locked).toEqual(['span'])
  })
})

describe('applyEdits', () => {
  it('changes, adds and removes props without touching anything else', () => {
    const out = applyEdits(SOURCE, [
      { kind: 'props', title: 'Top products', set: { span: 7, height: 360, horizontal: null } },
      { kind: 'props', title: 'Revenue', set: { span: 6 } },
    ])
    parses(out)
    expect(out).toContain('          span={7}\n          height={360}\n        />')
    expect(out).not.toContain('horizontal')
    expect(out).toContain(
      '<Stat title="Revenue" query="kpis" column="revenue" format="currency" span={6} />',
    )
    expect(out).toContain('<Stat title="Orders" query="kpis" column="orders" />')
    expect(out.split('\n').length).toBe(SOURCE.split('\n').length)
  })

  it('writes multiple y columns as an array literal', () => {
    const out = applyEdits(SOURCE, [
      { kind: 'props', title: 'Top products', set: { y: ['revenue', 'units'] } },
    ])
    expect(out).toContain("y={['revenue', 'units']}")
  })

  it('changes the chart type, maps props, and imports the new component in order', () => {
    const out = applyEdits(SOURCE, [
      { kind: 'component', title: 'Top products', component: 'PieChart' },
    ])
    parses(out)
    expect(out).toContain('<PieChart\n          title="Top products"')
    expect(out).toContain('label="product"')
    expect(out).toContain('value="revenue"')
    expect(out).not.toMatch(/\bx="product"|horizontal|\by="revenue"/)
    expect(out).toContain('  Dashboard,\n  PieChart,\n  Row,')
    expect(analyzeDashboard(out).panels.find((p) => p.title === 'Top products')?.component).toBe(
      'PieChart',
    )
  })

  it('reorders panels in a row, moving their note markers with them', () => {
    const out = applyEdits(SOURCE, [{ kind: 'order', titles: ['Recent orders', 'Top products'] }])
    parses(out)
    expect(out.indexOf('Recent orders')).toBeLessThan(out.indexOf('Top products'))
    expect(out.indexOf('@dashboard-comment')).toBeLessThan(out.indexOf('<BarChart'))
    expect(out.indexOf('<Table')).toBeLessThan(out.indexOf('@dashboard-comment'))
  })

  it('refuses what the page must not do', () => {
    expect(() =>
      applyEdits(SOURCE, [{ kind: 'props', title: 'Recent orders', set: { span: 4 } }]),
    ).toThrow(/computed in code \(cols\)/)
    expect(() =>
      applyEdits(SOURCE, [{ kind: 'props', title: 'Revenue', set: { span: 13 } }]),
    ).toThrow(/not a valid value/)
    expect(() =>
      applyEdits(SOURCE, [{ kind: 'props', title: 'Revenue', set: { query: 'other' } as never }]),
    ).toThrow(/cannot be changed/)
    expect(() =>
      applyEdits(SOURCE, [{ kind: 'props', title: 'Revenue', set: { format: 'bogus' } }]),
    ).toThrow(/not a valid value/)
    expect(() =>
      applyEdits(SOURCE, [{ kind: 'order', titles: ['Revenue', 'Top products'] }]),
    ).toThrow(/same row/)
    expect(() => applyEdits(SOURCE, [{ kind: 'props', title: 'Nope', set: { span: 2 } }])).toThrow(
      /no panel titled/,
    )
    expect(() =>
      applyEdits(SOURCE.replace('</Row>', '</Rowx>'), [
        { kind: 'props', title: 'Revenue', set: { span: 2 } },
      ]),
    ).toThrow(/syntax error/)
  })
})

describe('moving between rows', () => {
  it('lists rows in document order', () => {
    expect(describeLayout(SOURCE).rows.map((r) => r.titles)).toEqual([
      ['Revenue', 'Orders'],
      ['Top products', 'Recent orders'],
    ])
  })

  it('moves a panel up into another row, before a given panel', () => {
    const out = applyEdits(SOURCE, [{ kind: 'move', title: 'Recent orders', row: 0, index: 1 }])
    parses(out)
    expect(describeLayout(out).rows.map((r) => r.titles)).toEqual([
      ['Revenue', 'Recent orders', 'Orders'],
      ['Top products'],
    ])
    expect(out).toContain(
      '        <Table title="Recent orders" query="recent" span={cols} />\n        <Stat title="Orders"',
    )
  })

  it('carries a note marker down with its panel and re-indents a multi-line panel', () => {
    const out = applyEdits(SOURCE, [{ kind: 'move', title: 'Top products', row: 0, index: 0 }])
    parses(out)
    const rows = describeLayout(out).rows
    expect(rows[0]?.titles).toEqual(['Top products', 'Revenue', 'Orders'])
    const marker = out.indexOf('@dashboard-comment')
    expect(marker).toBeLessThan(out.indexOf('<BarChart'))
    expect(out.indexOf('<BarChart')).toBeLessThan(out.indexOf('title="Revenue"'))
    expect(out).toContain('        <BarChart\n          title="Top products"')
  })

  it('removes a row once its last panel leaves', () => {
    const out = applyEdits(SOURCE, [
      { kind: 'move', title: 'Revenue', row: 1, index: 2 },
      { kind: 'move', title: 'Orders', row: 1, index: 0 },
    ])
    parses(out)
    expect(describeLayout(out).rows.map((r) => r.titles)).toEqual([
      ['Orders', 'Top products', 'Recent orders', 'Revenue'],
    ])
    expect(out.match(/<Row/g)).toHaveLength(1)
  })

  it('swaps rows up and down', () => {
    const out = applyEdits(SOURCE, [{ kind: 'moveRow', from: 1, to: 0 }])
    parses(out)
    expect(describeLayout(out).rows.map((r) => r.titles)).toEqual([
      ['Top products', 'Recent orders'],
      ['Revenue', 'Orders'],
    ])
    expect(out).toContain('<Row height={320}>')
    expect(out.indexOf('<Row height={320}>')).toBeLessThan(out.indexOf('title="Revenue"'))
  })

  it('refuses a move to a row that does not exist', () => {
    expect(() =>
      applyEdits(SOURCE, [{ kind: 'move', title: 'Revenue', row: 5, index: 0 }]),
    ).toThrow(/no row 6/)
  })
})

describe('custom charts in the layout', () => {
  const CUSTOM = SOURCE.replace(
    '<Stat title="Orders" query="kpis" column="orders" />',
    '<Stat title="Orders" query="kpis" column="orders" />\n        <Radar title="Shape" query="kpis" axis="a" value="b" />',
  )

  it('counts a custom chart as a panel of its row, like the page does', () => {
    const layout = describeLayout(CUSTOM)
    expect(layout.rows[0]?.titles).toEqual(['Revenue', 'Orders', 'Shape'])
    expect(layout.panels.find((p) => p.title === 'Shape')?.component).toBe('Radar')
  })

  it('resizes and moves it, but never changes its type', () => {
    const resized = applyEdits(CUSTOM, [{ kind: 'props', title: 'Shape', set: { span: 4 } }])
    expect(resized).toContain('<Radar title="Shape" query="kpis" axis="a" value="b" span={4} />')
    const moved = applyEdits(CUSTOM, [{ kind: 'move', title: 'Shape', row: 1, index: 0 }])
    expect(describeLayout(moved).rows[1]?.titles[0]).toBe('Shape')
    expect(() =>
      applyEdits(CUSTOM, [{ kind: 'component', title: 'Shape', component: 'BarChart' }]),
    ).toThrow(/cannot change type/)
  })
})

describe('meta theme', () => {
  const META = `export const meta: DashboardMeta = {
  title: 'Sales',
  refresh: '5m',
}
`
  it('adds, replaces and removes meta.theme, keeping the layout', () => {
    const added = applyEdits(META, [{ kind: 'meta', key: 'theme', value: 'brand' }])
    expect(added).toBe(`export const meta: DashboardMeta = {
  title: 'Sales',
  refresh: '5m',
  theme: 'brand',
}
`)
    const replaced = applyEdits(added, [{ kind: 'meta', key: 'theme', value: 'night' }])
    expect(replaced).toContain(`theme: 'night',`)
    expect(applyEdits(replaced, [{ kind: 'meta', key: 'theme', value: null }])).toBe(META)
  })

  it('handles one-line objects and satisfies', () => {
    const code = `export const meta = { title: 'A' } satisfies DashboardMeta\n`
    const added = applyEdits(code, [{ kind: 'meta', key: 'theme', value: 'brand' }])
    expect(added).toBe(
      `export const meta = { title: 'A', theme: 'brand' } satisfies DashboardMeta\n`,
    )
    expect(applyEdits(added, [{ kind: 'meta', key: 'theme', value: null }])).toBe(code)
  })

  it('refuses a theme id that is not one, and a dashboard without meta', () => {
    expect(() => applyEdits(META, [{ kind: 'meta', key: 'theme', value: "x'; alert(1)" }])).toThrow(
      /not a theme id/,
    )
    expect(() =>
      applyEdits('export default 1\n', [{ kind: 'meta', key: 'theme', value: 'brand' }]),
    ).toThrow(/no `export const meta/)
  })
})

describe('editLayout', () => {
  let root: string
  let config: ResolvedConfig
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'odd-layout-'))
    mkdirSync(join(root, 'dashboards', 'sales'), { recursive: true })
    writeFileSync(join(root, 'dashboards', 'sales', 'index.tsx'), SOURCE)
    config = { root, dashboardsDir: 'dashboards' } as ResolvedConfig
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('writes once and returns the new hash', () => {
    const { hash } = readLayout(config, 'sales')
    const result = editLayout(
      config,
      'sales',
      [{ kind: 'props', title: 'Orders', set: { span: 3 } }],
      hash,
    )
    const written = readFileSync(join(root, 'dashboards', 'sales', 'index.tsx'), 'utf8')
    expect(written).toContain('column="orders" span={3}')
    expect(result.hash).toBe(hashSource(written))
  })

  it('refuses to save over a file that changed since it was read', () => {
    const { hash } = readLayout(config, 'sales')
    writeFileSync(
      join(root, 'dashboards', 'sales', 'index.tsx'),
      SOURCE.replace('Orders', 'Order count'),
    )
    expect(() =>
      editLayout(config, 'sales', [{ kind: 'props', title: 'Revenue', set: { span: 3 } }], hash),
    ).toThrow(/changed on disk/)
  })
})
