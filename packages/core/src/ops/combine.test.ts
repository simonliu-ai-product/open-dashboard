import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadConfig } from '../workspace.js'
import { checkDashboard } from './check.js'
import { runDashboardQuery } from './dashboards.js'
import { type Fixture, makeFixture } from './fixture.test-helper.js'
import { cacheKey, parseDuration, QueryCache } from './query-cache.js'

const QUERIES = `-- name: sales_by_region
-- source: db
SELECT region, SUM(amount) AS amount FROM sales WHERE amount >= :min GROUP BY region

-- name: targets
-- source: plans
SELECT region, target FROM targets

-- name: attainment
-- uses: sales_by_region, targets
SELECT s.region, s.amount, t.target, s.amount / t.target AS share
FROM sales_by_region s JOIN targets t USING (region)
WHERE s.amount >= :min
ORDER BY s.region
`

const DASHBOARD = `import { Dashboard, Table } from '@open-dashboard/core'
export default function Sales() {
  return <Dashboard><Table title="Attainment" query="attainment" /></Dashboard>
}
`

let fixture: Fixture

async function withConfig(extra = ''): Promise<void> {
  fixture.write(
    'open-dashboard.config.mjs',
    `export default { datasources: { db: { type: 'sqlite', file: 'test.db' }, plans: { type: 'sqlite', file: 'plans.db' } }, defaultSource: 'db'${extra} }\n`,
  )
  await fixture.workspace.reconfigure(await loadConfig(fixture.root))
}

beforeEach(async () => {
  fixture = await makeFixture({
    'dashboards/sales/queries.sql': QUERIES,
    'dashboards/sales/index.tsx': DASHBOARD,
  })
  const plans = new DatabaseSync(join(fixture.root, 'plans.db'))
  plans.exec(`
    CREATE TABLE targets (region TEXT PRIMARY KEY, target REAL NOT NULL);
    INSERT INTO targets VALUES ('North', 50), ('South', 40);
  `)
  plans.close()
  await withConfig()
})

afterEach(() => fixture.cleanup())

describe('-- uses: queries across databases', () => {
  it('joins results from two databases', async () => {
    const run = await runDashboardQuery(fixture.workspace, 'sales', 'attainment', { min: 0 })
    expect(run.query.source).toBe('combined')
    expect(run.query.uses).toEqual(['sales_by_region', 'targets'])
    expect(run.result.rows).toEqual([
      { region: 'North', amount: 40, target: 50, share: 0.8 },
      { region: 'South', amount: 20, target: 40, share: 0.5 },
    ])
  })

  it('passes the same parameters to its inputs and to itself', async () => {
    const run = await runDashboardQuery(fixture.workspace, 'sales', 'attainment', { min: 25 })
    expect(run.result.rows).toEqual([{ region: 'North', amount: 30, target: 50, share: 0.6 }])
  })

  it('marks the result truncated when an input was cut short', async () => {
    await withConfig(', maxRows: 1')
    const run = await runDashboardQuery(fixture.workspace, 'sales', 'attainment', { min: 0 })
    expect(run.result.truncated).toBe(true)
  })

  it('runs only reads, and only over the scratch tables', async () => {
    for (const sql of [
      'DELETE FROM targets',
      "ATTACH 'test.db' AS real",
      'SELECT 1; DROP TABLE targets',
    ]) {
      fixture.write(
        'dashboards/sales/queries.sql',
        QUERIES.replace(
          /-- name: attainment[\s\S]*$/,
          `-- name: attainment\n-- uses: targets\n${sql}\n`,
        ),
      )
      await expect(
        runDashboardQuery(fixture.workspace, 'sales', 'attainment', { min: 0 }, { fresh: true }),
      ).rejects.toThrow(/combined query/)
    }
  })

  it('refuses a query that uses itself through another', async () => {
    fixture.write(
      'dashboards/sales/queries.sql',
      `-- name: a\n-- uses: b\nSELECT * FROM b\n\n-- name: b\n-- uses: a\nSELECT * FROM a\n`,
    )
    await expect(runDashboardQuery(fixture.workspace, 'sales', 'a')).rejects.toThrow(
      'queries use each other in a loop: a → b → a',
    )
  })

  it('is checked: unknown inputs, loops, and inputs count as used', async () => {
    const file = join(fixture.root, 'dashboards/sales/index.tsx')
    let report = await checkDashboard(fixture.workspace, 'sales', file)
    expect(report.findings.map((f) => f.message)).not.toContainEqual(
      expect.stringContaining('no panel uses it'),
    )
    fixture.write(
      'dashboards/sales/queries.sql',
      `-- name: attainment\n-- uses: nowhere\nSELECT * FROM nowhere\n\n-- name: a\n-- uses: b\nSELECT 1\n\n-- name: b\n-- uses: a\nSELECT 1\n`,
    )
    report = await checkDashboard(fixture.workspace, 'sales', file)
    const messages = report.findings.map((f) => f.message)
    expect(messages).toContain(
      'query "attainment" uses "nowhere", which is not defined in this dashboard',
    )
    expect(messages).toContain('queries use each other in a loop: a → b → a')
  })
})

describe('query cache', () => {
  it('serves a repeat from the cache and reruns when asked to', async () => {
    const first = await runDashboardQuery(fixture.workspace, 'sales', 'attainment', { min: 0 })
    const again = await runDashboardQuery(fixture.workspace, 'sales', 'attainment', { min: 0 })
    expect(again.ranAt).toBe(first.ranAt)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const fresh = await runDashboardQuery(
      fixture.workspace,
      'sales',
      'attainment',
      { min: 0 },
      { fresh: true },
    )
    expect(fresh.ranAt).not.toBe(first.ranAt)
  })

  it('keys on the parameters the query reads, not every filter', async () => {
    const a = await runDashboardQuery(fixture.workspace, 'sales', 'targets', { region: 'North' })
    const b = await runDashboardQuery(fixture.workspace, 'sales', 'targets', { region: 'South' })
    expect(b.ranAt).toBe(a.ranAt)
    expect(b.params).toEqual({ region: 'South' })
  })

  it('can be switched off per query and for the workspace', async () => {
    fixture.write(
      'dashboards/sales/queries.sql',
      QUERIES.replace('-- source: plans', '-- source: plans\n-- cache: off'),
    )
    const a = await runDashboardQuery(fixture.workspace, 'sales', 'targets')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const b = await runDashboardQuery(fixture.workspace, 'sales', 'targets')
    expect(b.ranAt).not.toBe(a.ranAt)

    await withConfig(', cache: false')
    const c = await runDashboardQuery(fixture.workspace, 'sales', 'sales_by_region', { min: 0 })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const d = await runDashboardQuery(fixture.workspace, 'sales', 'sales_by_region', { min: 0 })
    expect(d.ranAt).not.toBe(c.ranAt)
  })

  it('shares one run between identical requests in flight, and forgets failures', async () => {
    const cache = new QueryCache<number>()
    let runs = 0
    const run = () => {
      runs += 1
      return Promise.reject(new Error('down'))
    }
    const pending = run()
    cache.set('k', 'd', pending, 60_000)
    expect(cache.get('k')?.value).toBe(pending)
    await expect(pending).rejects.toThrow('down')
    await Promise.resolve()
    expect(cache.get('k')).toBeUndefined()
    expect(runs).toBe(1)
  })

  it('expires, evicts the least recently used, and clears per dashboard', () => {
    const cache = new QueryCache<number>(2)
    cache.set('a', 'one', Promise.resolve(1), 1000, 0)
    cache.set('b', 'two', Promise.resolve(2), 1000, 0)
    cache.get('a', 1)
    cache.set('c', 'two', Promise.resolve(3), 1000, 0)
    expect(cache.get('b', 1)).toBeUndefined()
    expect(cache.get('a', 2000)).toBeUndefined()
    cache.clear('two')
    expect(cache.size).toBe(0)
  })

  it('reads durations and builds keys from what the query reads', () => {
    expect(['30s', '5m', '1h', '250ms', 'off', '0', 'soon'].map(parseDuration)).toEqual([
      30_000,
      300_000,
      3_600_000,
      250,
      0,
      0,
      undefined,
    ])
    expect(cacheKey('d', 'q', { a: 1, b: 2 }, ['a'])).toBe(
      cacheKey('d', 'q', { a: 1, b: 9 }, ['a']),
    )
    expect(cacheKey('d', 'q', { a: 1 }, ['a'])).not.toBe(cacheKey('d', 'q', { a: 2 }, ['a']))
  })
})
