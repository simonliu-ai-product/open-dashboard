import { join } from 'node:path'
import { checkDashboard } from './check.js'
import { type Fixture, makeFixture } from './fixture.test-helper.js'

const DASHBOARD = `import { Dashboard, Filters, Row, Select, Stat, type DashboardMeta } from '@open-dashboard/core'

export const meta: DashboardMeta = { title: 'Sales' }

export default function Sales() {
  return (
    <Dashboard>
      <Filters>
        <Select name="region" query="regions" />
      </Filters>
      <Row>
        <Stat title="Total" query="total" column="amount" />
      </Row>
    </Dashboard>
  )
}
`

// North sells 40, South 20: the total is 60 with no region picked.
const queries = (expects: string) => `-- name: regions
SELECT DISTINCT region FROM sales ORDER BY region;

-- name: total
${expects}
SELECT SUM(amount) AS amount FROM sales WHERE (:region IS NULL OR region = :region);
`

let fixture: Fixture
const file = () => join(fixture.root, 'dashboards/sales/index.tsx')
const errors = (findings: { severity: string; message: string }[]) =>
  findings.filter((f) => f.severity === 'error').map((f) => f.message)

beforeEach(async () => {
  fixture = await makeFixture({ 'dashboards/sales/index.tsx': DASHBOARD })
})

afterEach(() => fixture.cleanup())

describe('check', () => {
  it('reports each broken -- expect: rule as an error', async () => {
    fixture.write(
      'dashboards/sales/queries.sql',
      queries('-- expect: rows = 1\n-- expect: amount between 0 and 50'),
    )
    const report = await checkDashboard(fixture.workspace, 'sales', file())
    expect(errors(report.findings)).toEqual([
      'query "total" expects amount between 0 and 50: row 1: amount = 60, not between 0 and 50',
    ])
    expect(report.queries.find((q) => q.name === 'total')?.expectations).toHaveLength(2)
  })

  it('reports a rule it cannot read rather than passing it', async () => {
    fixture.write('dashboards/sales/queries.sql', queries('-- expect: looks right'))
    const [message] = errors((await checkDashboard(fixture.workspace, 'sales', file())).findings)
    expect(message).toMatch(
      /^query "total" expects looks right: "looks right" is not an expectation/,
    )
  })

  it('checks at the params it is given instead of the defaults', async () => {
    fixture.write('dashboards/sales/queries.sql', queries('-- expect: amount >= 30'))
    const report = await checkDashboard(fixture.workspace, 'sales', file(), {
      params: { region: 'South' },
    })
    expect(report.params.region).toBe('South')
    expect(errors(report.findings)).toEqual([
      'query "total" expects amount >= 30: row 1: amount = 20, expected >= 30',
    ])
  })

  /* The defaults pass; only a reader who picks South would see the broken number. */
  it('finds what breaks under other filter values with allParams', async () => {
    fixture.write('dashboards/sales/queries.sql', queries('-- expect: amount >= 30'))
    expect(errors((await checkDashboard(fixture.workspace, 'sales', file())).findings)).toEqual([])

    const report = await checkDashboard(fixture.workspace, 'sales', file(), { allParams: true })
    expect(errors(report.findings)).toEqual([
      'query "total" expects amount >= 30, but at region=South: row 1: amount = 20, expected >= 30',
    ])
    expect(report.sweep?.runs).toBeGreaterThanOrEqual(3)
    expect(report.sweep?.slowest.map((q) => q.name)).toContain('total')
  })

  it('warns about a query slower than slowMs', async () => {
    fixture.write('dashboards/sales/queries.sql', queries(''))
    const report = await checkDashboard(fixture.workspace, 'sales', file(), { slowMs: -1 })
    expect(
      report.findings.some((f) => /^query "total" took \d+ ms \(over -1 ms\)$/.test(f.message)),
    ).toBe(true)
  })
})
