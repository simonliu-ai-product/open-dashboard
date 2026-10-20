import { type Fixture, makeFixture } from './fixture.test-helper.js'
import { lintWorkspace } from './lint.js'

const dashboard = (
  title: string,
  refresh = '',
) => `import { Dashboard, Row, Stat, type DashboardMeta } from '@open-dashboard/core'

export const meta: DashboardMeta = { title: '${title}', description: 'x'${refresh ? `, refresh: '${refresh}'` : ''} }

export default function D() {
  return (
    <Dashboard>
      <Row>
        <Stat title="Total" query="total" column="amount" />
      </Row>
    </Dashboard>
  )
}
`

const TOTAL = `-- name: total
-- description: all sales
SELECT SUM(amount) AS amount, COUNT(*) AS orders, MIN(day) AS first_day
FROM sales WHERE amount > 0;
`

let fixture: Fixture
const rules = (id: string) =>
  lintWorkspace(fixture.workspace, id)[0]?.findings.map((f) => f.rule) ?? []

afterEach(() => fixture.cleanup())

describe('lint', () => {
  it('flags the same SQL written in two dashboards', async () => {
    fixture = await makeFixture({
      'dashboards/a/index.tsx': dashboard('A'),
      'dashboards/a/queries.sql': TOTAL,
      'dashboards/b/index.tsx': dashboard('B'),
      // Same query, other spacing and case: still a copy.
      'dashboards/b/queries.sql': TOTAL.replace('SELECT SUM', 'select   sum').replace(
        '-- description: all sales',
        '-- description: total sales',
      ),
    })
    const [finding] =
      lintWorkspace(fixture.workspace, 'a')[0]?.findings.filter(
        (f) => f.rule === 'duplicate-query',
      ) ?? []
    expect(finding?.message).toBe(
      'query "total" is the same SQL as "total" in b — move it to queries/*.sql and name it from each',
    )
  })

  it('leaves shared queries and short ones alone', async () => {
    fixture = await makeFixture({
      'queries/total.sql': TOTAL,
      'dashboards/a/index.tsx': dashboard('A'),
      'dashboards/b/index.tsx': dashboard('B'),
    })
    expect(rules('a')).not.toContain('duplicate-query')
  })

  it('notes a refresh no build elsewhere can honour', async () => {
    fixture = await makeFixture({
      'dashboards/a/index.tsx': dashboard('A', '1m'),
      'dashboards/a/queries.sql': TOTAL,
    })
    const finding = lintWorkspace(fixture.workspace, 'a')[0]?.findings.find(
      (f) => f.rule === 'refresh-without-live-source',
    )
    expect(finding?.message).toMatch(/^meta.refresh is 1m, but no source it reads is live \(db\)/)
  })

  it('asks for expectations until one query has one', async () => {
    fixture = await makeFixture({
      'dashboards/a/index.tsx': dashboard('A'),
      'dashboards/a/queries.sql': TOTAL,
    })
    expect(rules('a')).toContain('missing-expectations')
    fixture.write(
      'dashboards/a/queries.sql',
      TOTAL.replace('-- description: all sales', '-- description: all sales\n-- expect: rows = 1'),
    )
    expect(rules('a')).not.toContain('missing-expectations')
  })
})
