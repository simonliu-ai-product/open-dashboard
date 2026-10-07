import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { type Fixture, makeFixture } from './fixture.test-helper.js'
import { queryHistory } from './history.js'

let fixture: Fixture | undefined
afterEach(async () => {
  await fixture?.cleanup()
  fixture = undefined
})

const LAYOUT = `export const meta = { title: 'Sales' }
export default function S() { return null }
`

function git(root: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=Analyst', '-c', 'user.email=analyst@example.com', ...args],
    { cwd: root, stdio: 'ignore' },
  )
}

describe('queryHistory', () => {
  it("lists the commits that changed this query, not its neighbours'", async () => {
    fixture = await makeFixture({
      'dashboards/sales/index.tsx': LAYOUT,
      'dashboards/sales/queries.sql':
        '-- name: total\nSELECT SUM(amount) AS total FROM sales;\n\n-- name: rows\nSELECT * FROM sales;\n',
    })
    const { root, write } = fixture
    git(root, 'init', '-q')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'Add sales')
    write(
      'dashboards/sales/queries.sql',
      '-- name: total\nSELECT SUM(amount) AS total FROM sales WHERE amount > 0;\n\n-- name: rows\nSELECT * FROM sales;\n',
    )
    git(root, 'commit', '-qam', 'Leave refunds out of total')
    write(
      'dashboards/sales/queries.sql',
      '-- name: total\nSELECT SUM(amount) AS total FROM sales WHERE amount > 0;\n\n-- name: rows\nSELECT * FROM sales ORDER BY id;\n',
    )
    git(root, 'commit', '-qam', 'Sort rows')

    const history = await queryHistory(fixture.workspace.config, 'sales', 'total')
    expect(history.tracked).toBe(true)
    expect(history.uncommitted).toBe(false)
    expect(history.changes.map((c) => c.subject)).toEqual([
      'Leave refunds out of total',
      'Add sales',
    ])
    const [latest] = history.changes
    expect(latest?.author).toBe('Analyst')
    expect(JSON.stringify(history)).not.toContain('analyst@example.com')
    expect(latest?.diff).toContain('+SELECT SUM(amount) AS total FROM sales WHERE amount > 0;')
    expect(latest?.diff).toContain('-SELECT SUM(amount) AS total FROM sales;')

    write(
      'dashboards/sales/queries.sql',
      '-- name: total\nSELECT SUM(amount) AS total FROM sales WHERE amount >= 0;\n\n-- name: rows\nSELECT * FROM sales ORDER BY id;\n',
    )
    expect((await queryHistory(fixture.workspace.config, 'sales', 'total')).uncommitted).toBe(true)
    expect((await queryHistory(fixture.workspace.config, 'sales', 'rows')).uncommitted).toBe(false)
  })

  it('says so when the workspace is not in git', async () => {
    fixture = await makeFixture({
      'dashboards/sales/index.tsx': LAYOUT,
      'dashboards/sales/queries.sql': '-- name: total\nSELECT 1 AS total;\n',
    })
    const history = await queryHistory(fixture.workspace.config, 'sales', 'total')
    expect(history).toMatchObject({ tracked: false, changes: [] })
  })

  it('refuses a query the dashboard does not have', async () => {
    fixture = await makeFixture({
      'dashboards/sales/index.tsx': LAYOUT,
      'dashboards/sales/queries.sql': '-- name: total\nSELECT 1 AS total;\n',
    })
    await expect(queryHistory(fixture.workspace.config, 'sales', 'nope')).rejects.toThrow(
      /no query/,
    )
  })
})
