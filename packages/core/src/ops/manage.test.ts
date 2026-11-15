import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Fixture, makeFixture } from './fixture.test-helper.js'
import { hashSource } from './layout.js'
import {
  copyTitle,
  duplicateDashboard,
  nextCopyId,
  renameDashboard,
  trashDashboard,
} from './manage.js'

const LAYOUT = `import { Stat } from '@open-dashboard/core'

export const meta = {
  title: 'Sales',
  description: 'Daily sales',
}

export default function Dashboard() {
  return <Stat title="Total" query="total" value="n" />
}
`

let fixture: Fixture
beforeEach(async () => {
  fixture = await makeFixture({
    'dashboards/sales/index.tsx': LAYOUT,
    'dashboards/sales/queries.sql': '-- name: total\nselect 1 as n\n',
  })
})
afterEach(() => fixture.cleanup())

const index = (id: string) =>
  readFileSync(join(fixture.root, 'dashboards', id, 'index.tsx'), 'utf8')

describe('managing dashboards', () => {
  it('renames through meta.title, escaping quotes, and refuses a stale hash', () => {
    const config = fixture.workspace.config
    const out = renameDashboard(config, 'sales', "Sales' report \\ 2026", hashSource(LAYOUT))
    expect(index('sales')).toContain(`title: 'Sales\\' report \\\\ 2026',`)
    expect(index('sales')).toContain("description: 'Daily sales',")
    expect(out.hash).toBe(hashSource(index('sales')))
    expect(() => renameDashboard(config, 'sales', 'Again', hashSource(LAYOUT))).toThrow(
      /changed on disk/,
    )
    expect(() => renameDashboard(config, 'sales', ' ')).toThrow(/1 to 200/)
  })

  it('duplicates the folder with its queries under the next free id and a (copy) title', () => {
    const config = fixture.workspace.config
    expect(duplicateDashboard(config, 'sales')).toEqual({ id: 'sales-copy', title: 'Sales (copy)' })
    expect(readFileSync(join(fixture.root, 'dashboards/sales-copy/queries.sql'), 'utf8')).toContain(
      'total',
    )
    expect(index('sales-copy')).toContain("title: 'Sales (copy)'")
    expect(duplicateDashboard(config, 'sales-copy').id).toBe('sales-copy-2')
    expect(() => duplicateDashboard(config, 'sales', 'sales-copy')).toThrow(/already exists/)
    expect(() => duplicateDashboard(config, 'sales', '../x')).toThrow(/not a dashboard id/)
    expect(index('sales')).toBe(LAYOUT)
  })

  it('moves a deleted dashboard to the trash rather than removing it', () => {
    const config = fixture.workspace.config
    const { trashedTo } = trashDashboard(config, 'sales')
    expect(existsSync(join(fixture.root, 'dashboards/sales'))).toBe(false)
    expect(readdirSync(join(fixture.root, trashedTo))).toEqual(['index.tsx', 'queries.sql'])
    expect(() => trashDashboard(config, 'sales')).toThrow(/no dashboard/)
  })

  it('names copies the way open-doc does', () => {
    expect(nextCopyId('a', new Set())).toBe('a-copy')
    expect(nextCopyId('a-copy', new Set(['a-copy']))).toBe('a-copy-2')
    expect(copyTitle('A (copy)')).toBe('A (copy)')
  })
})

describe('creating a dashboard', () => {
  it('writes a blank dashboard that passes check, with an id from its title', async () => {
    const { createDashboard, idFromTitle } = await import('./manage.js')
    const { checkWorkspace } = await import('./check.js')
    const config = fixture.workspace.config
    expect(createDashboard(config, "Q3 'Sales' review")).toEqual({
      id: 'q3-sales-review',
      title: "Q3 'Sales' review",
    })
    expect(index('q3-sales-review')).toContain("title: 'Q3 \\'Sales\\' review',")
    expect(createDashboard(config, '營收總覽').id).toBe('dashboard')
    expect(createDashboard(config, '成本總覽').id).toBe('dashboard-2')
    expect(idFromTitle('Café — North/East')).toBe('cafe-north-east')
    expect(() => createDashboard(config, '  ')).toThrow(/1 to 200/)
    const [report] = await checkWorkspace(fixture.workspace, 'q3-sales-review')
    expect(report?.title).toBe("Q3 'Sales' review")
    expect(report?.findings.filter((f) => f.severity === 'error')).toEqual([])
  })
})
