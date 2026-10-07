import { afterEach, describe, expect, it } from 'vitest'
import { snapshotKey, stripBase, withBase } from '../runtime/snapshot.js'
import { type Fixture, makeFixture } from './fixture.test-helper.js'
import { snapshotDashboard } from './snapshot.js'

let fixture: Fixture | undefined
afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

const LAYOUT = `import { Dashboard, Filters, Select, Stat, Table, TimeRange } from '@open-dashboard/core'
export const meta = { title: 'Sales' }
export default function S() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange default="all" options={['all', '30d']} />
        <Select name="region" query="regions" />
      </Filters>
      <Stat title="Total" query="total" />
      <Table title="Rows" query="rows" />
    </Dashboard>
  )
}
`

const QUERIES = `-- name: regions
SELECT DISTINCT region FROM sales ORDER BY region;

-- name: total
SELECT SUM(amount) AS total FROM sales
WHERE day >= :from AND day < :to AND (:region IS NULL OR region = :region);

-- name: rows
SELECT id, amount FROM sales ORDER BY id;
`

describe('snapshotDashboard', () => {
  it('runs every combination of the filters a query reads, and only those', async () => {
    fixture = await makeFixture({
      'dashboards/sales/index.tsx': LAYOUT,
      'dashboards/sales/queries.sql': QUERIES,
    })
    const snap = await snapshotDashboard(fixture.workspace, 'sales', {
      now: new Date(2026, 8, 10),
    })
    const total = snap.queries.total
    expect(total?.reads).toEqual(['from', 'region', 'to'])
    // 2 presets × (all, North, South)
    expect(Object.keys(total?.results ?? {})).toHaveLength(6)
    const south =
      total?.results[
        snapshotKey({ from: '0001-01-01', to: '9999-12-31', region: 'South' }, total.reads)
      ]
    expect(south && 'result' in south ? south.result.rows : undefined).toEqual([{ total: 20 }])
    // A query that reads no filter runs once.
    expect(Object.keys(snap.queries.rows?.results ?? {})).toHaveLength(1)
    expect(snap.trimmed).toEqual([])
  })

  it('keeps no SQL or file path in what it stores', async () => {
    fixture = await makeFixture({
      'dashboards/sales/index.tsx': LAYOUT,
      'dashboards/sales/queries.sql': QUERIES,
    })
    const snap = await snapshotDashboard(fixture.workspace, 'sales')
    const text = JSON.stringify(snap)
    expect(text).not.toContain('SELECT')
    expect(text).not.toContain(fixture.root)
  })

  it('falls back to defaults past the run limit', async () => {
    fixture = await makeFixture({
      'dashboards/sales/index.tsx': LAYOUT,
      'dashboards/sales/queries.sql': QUERIES,
    })
    const snap = await snapshotDashboard(fixture.workspace, 'sales', { maxRuns: 3 })
    expect(snap.trimmed).toEqual(['total'])
    expect(Object.keys(snap.queries.total?.results ?? {}).length).toBeLessThanOrEqual(3)
  })

  it('stores a failing query as its error', async () => {
    fixture = await makeFixture({
      'dashboards/sales/index.tsx': LAYOUT,
      'dashboards/sales/queries.sql': `${QUERIES}\n-- name: broken\nSELECT nope FROM sales;\n`,
    })
    const snap = await snapshotDashboard(fixture.workspace, 'sales')
    const [only] = Object.values(snap.queries.broken?.results ?? {})
    expect(only && 'error' in only ? only.error : '').toContain('nope')
  })
})

describe('snapshot paths and keys', () => {
  it('maps in-app paths onto the site base and back', () => {
    const store = globalThis as { __ODD_SNAPSHOT__?: unknown }
    store.__ODD_SNAPSHOT__ = { base: '/repo/', builtAt: '2026-09-10T10:00:00' }
    try {
      expect(withBase('/d/sales')).toBe('/repo/d/sales')
      expect(stripBase('/repo/d/sales/')).toBe('/d/sales/')
      expect(stripBase('/repo/')).toBe('/')
    } finally {
      delete store.__ODD_SNAPSHOT__
    }
    expect(withBase('/d/sales')).toBe('/d/sales')
  })

  it('keys a result by the parameters the query reads', () => {
    expect(snapshotKey({ region: 'North', time: 'x' }, ['region'])).toBe(
      snapshotKey({ region: 'North' }, ['region']),
    )
    expect(snapshotKey({}, ['region'])).toBe('[["region",null]]')
  })
})
