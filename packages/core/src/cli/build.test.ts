import { type Fixture, makeFixture } from '../ops/fixture.test-helper.js'
import { snapshotFiles } from './build.js'

const DASHBOARD = `import { Dashboard, Row, Stat, type DashboardMeta } from '@open-dashboard/core'
export const meta: DashboardMeta = { title: 'Sales' }
export default function D() {
  return (<Dashboard><Row><Stat title="Total" query="total" column="amount" /></Row></Dashboard>)
}
`

let fixture: Fixture
beforeEach(async () => {
  fixture = await makeFixture({
    'dashboards/sales/index.tsx': DASHBOARD,
    'dashboards/sales/queries.sql': '-- name: total\nSELECT SUM(amount) AS amount FROM sales;\n',
  })
})
afterEach(() => fixture.cleanup())

describe('snapshotFiles', () => {
  /* A site on GitHub Pages is public: by default it holds results, never the SQL behind them. */
  it('writes no SQL unless asked to be queryable', async () => {
    const { files } = await snapshotFiles(fixture.workspace, ['sales'], { now: new Date() })
    expect([...files.keys()].some((k) => k.endsWith('_queries.json'))).toBe(false)
    expect(JSON.stringify([...files.values()])).not.toContain('SUM(amount)')
  })

  it('writes each query’s SQL for a host when queryable', async () => {
    const { files } = await snapshotFiles(fixture.workspace, ['sales'], {
      now: new Date(),
      queryable: true,
    })
    expect(JSON.stringify(files.get('d/sales/_queries.json'))).toContain('SUM(amount)')
  })
})
