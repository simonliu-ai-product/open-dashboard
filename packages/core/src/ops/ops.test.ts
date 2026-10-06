import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { loadConfig } from '../workspace.js'
import { analyzeDashboard } from './analyze.js'
import { chartCatalog, listCharts, readChartSpec, runChartQuery } from './charts.js'
import { checkDashboard } from './check.js'
import { addComment, listComments } from './comment.js'
import { listDashboards, runDashboardQuery, runSql } from './dashboards.js'
import { docSourceOf, readDatabaseDoc, writeDatabaseDoc } from './database-doc.js'
import { type Fixture, makeFixture } from './fixture.test-helper.js'
import { staleSkills, syncSkills } from './skills.js'
import { describeSource, readSchema, schemaToText } from './sources.js'

const DASHBOARD = `import { Dashboard, Filters, Row, Select, Stat, BarChart, TimeRange, type DashboardMeta } from '@open-dashboard/core'

export const meta: DashboardMeta = { title: 'Sales', description: 'Test' }

export default function Sales() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange default="all" />
        <Select name="region" query="regions" />
      </Filters>
      <Row>
        <Stat title="Total" query="total" column="amount" />
        <BarChart title="By region" query="by_region" x="region" y="amount" />
      </Row>
    </Dashboard>
  )
}
`

const QUERIES = `-- name: regions
SELECT DISTINCT region FROM sales ORDER BY region;

-- name: total
SELECT SUM(amount) AS amount FROM sales
WHERE day >= :from AND day < :to AND (:region IS NULL OR region = :region);

-- name: by_region
SELECT region, SUM(amount) AS amount FROM sales
WHERE day >= :from AND day < :to
GROUP BY region ORDER BY amount DESC;
`

let fixture: Fixture

beforeEach(async () => {
  fixture = await makeFixture({
    'dashboards/sales/index.tsx': DASHBOARD,
    'dashboards/sales/queries.sql': QUERIES,
  })
})

afterEach(() => fixture.cleanup())

describe('dashboards', () => {
  it('lists dashboards with the title read from meta', () => {
    expect(listDashboards(fixture.workspace.config)).toEqual([
      {
        id: 'sales',
        title: 'Sales',
        description: 'Test',
        queries: 3,
        panels: 2,
        sources: ['db'],
        file: 'dashboards/sales/index.tsx',
      },
    ])
  })

  it('runs a named query with bound params', async () => {
    const run = await runDashboardQuery(fixture.workspace, 'sales', 'total', {
      from: '2026-01-01',
      to: '2027-01-01',
      region: 'North',
    })
    expect(run.query.source).toBe('db')
    expect(run.result.rows).toEqual([{ amount: 40 }])
    expect(run.result.columns).toEqual([{ name: 'amount', type: 'number' }])
  })

  it('refuses an unknown query and names the defined ones', async () => {
    await expect(runDashboardQuery(fixture.workspace, 'sales', 'nope')).rejects.toThrow(
      /defined: regions, total, by_region/,
    )
  })

  it('refuses ids that could escape the dashboards folder', async () => {
    await expect(runDashboardQuery(fixture.workspace, '../etc', 'total')).rejects.toThrow(
      /not a dashboard id/,
    )
  })
})

describe('read-only', () => {
  it('cannot write through a query', async () => {
    await expect(
      runSql(fixture.workspace, "INSERT INTO sales (day, region, amount) VALUES ('x', 'y', 1)"),
    ).rejects.toThrow(/readonly|read-only|query_only/i)
    await expect(runSql(fixture.workspace, 'DELETE FROM sales')).rejects.toThrow()
    const count = await runSql(fixture.workspace, 'SELECT count(*) AS n FROM sales')
    expect(count.rows[0]?.n).toBe(3)
  })

  it('caps the rows it returns', async () => {
    fixture.workspace.config.maxRows = 2
    const result = await runSql(fixture.workspace, 'SELECT * FROM sales')
    expect(result.rows).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})

describe('schema', () => {
  it('describes tables, keys and row counts', async () => {
    const schema = await readSchema(fixture.workspace)
    expect(schema.tables[0]).toMatchObject({ name: 'sales', kind: 'table', rowCount: 3 })
    expect(schemaToText(schema)).toContain('- id  INTEGER  PK NOT NULL')
  })
})

describe('analyze', () => {
  it('reads filters, panels and the columns they name', () => {
    const analysis = analyzeDashboard(DASHBOARD)
    expect(analysis.meta.title).toBe('Sales')
    expect(analysis.filters.map((f) => [f.kind, f.name, f.default])).toEqual([
      ['TimeRange', undefined, 'all'],
      ['Select', 'region', undefined],
    ])
    expect(analysis.panels.map((p) => [p.component, p.title, p.query, p.columns])).toEqual([
      ['Stat', 'Total', 'total', ['amount']],
      ['BarChart', 'By region', 'by_region', ['region', 'amount']],
    ])
  })
})

const RADAR = `import { defineChart } from '@open-dashboard/core'

export default defineChart({
  name: 'Radar',
  columns: ['axis', 'value'],
  sample: { query: 'sample', props: { axis: 'region', value: 'amount' } },
  render: () => null,
})
`

describe('custom charts', () => {
  const file = () => join(fixture.root, 'dashboards/sales/index.tsx')
  const withRadar = (props: string) =>
    DASHBOARD.replace(
      "from '@open-dashboard/core'\n",
      "from '@open-dashboard/core'\nimport Radar from '../../charts/radar'\n",
    ).replace('</Row>', `  <Radar title="Shape" query="by_region" ${props} />\n      </Row>`)

  it('reads what defineChart says about itself, without running it', () => {
    expect(readChartSpec(RADAR, 'radar')).toEqual({
      name: 'Radar',
      columns: ['axis', 'value'],
      sample: { query: 'sample', props: { axis: 'region', value: 'amount' } },
    })
  })

  it('lists charts with their queries and the dashboards that use them', () => {
    fixture.write('charts/radar/index.tsx', RADAR)
    fixture.write(
      'charts/radar/sample.sql',
      '-- name: sample\nSELECT region, SUM(amount) AS amount FROM sales GROUP BY region\n',
    )
    fixture.write('dashboards/sales/index.tsx', withRadar('axis="region" value="amount"'))
    expect(listCharts(fixture.workspace.config)).toEqual([
      expect.objectContaining({
        id: 'radar',
        name: 'Radar',
        queries: ['sample'],
        usedBy: ['sales'],
      }),
    ])
    expect(listDashboards(fixture.workspace.config)[0]?.panels).toBe(3)
  })

  it('checks the columns a custom chart names', async () => {
    fixture.write('charts/radar/index.tsx', RADAR)
    fixture.write('dashboards/sales/index.tsx', withRadar('axis="region" value="revenue"'))
    const messages = (await checkDashboard(fixture.workspace, 'sales', file())).findings.map(
      (f) => f.message,
    )
    expect(messages).toContain(
      'column "revenue" is not in the result of "by_region" (has: region, amount)',
    )
  })

  it('catalogs built-ins and custom charts with their uses and a real example', async () => {
    fixture.write('charts/radar/index.tsx', RADAR)
    fixture.write('dashboards/sales/index.tsx', withRadar('axis="region" value="amount"'))
    const catalog = await chartCatalog(fixture.workspace)
    expect(catalog).toHaveLength(41)
    expect(catalog[0]).toMatchObject({
      kind: 'custom',
      id: 'radar',
      usedBy: [{ dashboard: 'sales', title: 'Shape' }],
    })
    const bar = catalog.find((entry) => entry.name === 'BarChart')
    expect(bar).toMatchObject({ kind: 'built-in', group: 'Basics', columns: ['x', 'y', 'series'] })
    expect(bar?.example).toMatchObject({
      dashboard: 'sales',
      title: 'By region',
      props: { query: 'by_region', x: 'region', y: 'amount' },
      params: { region: null },
    })
    expect(catalog.find((entry) => entry.name === 'Sankey')?.usedBy).toEqual([])
  })

  it('runs a chart sample from its own folder only', async () => {
    fixture.write('charts/radar/index.tsx', RADAR)
    fixture.write('charts/radar/sample.sql', '-- name: sample\nSELECT COUNT(*) AS n FROM sales\n')
    const run = await runChartQuery(fixture.workspace, 'radar', 'sample')
    expect(run.result.rows).toEqual([{ n: 3 }])
    await expect(runChartQuery(fixture.workspace, '../dashboards', 'sample')).rejects.toThrow(
      /not a chart id/,
    )
    await expect(runChartQuery(fixture.workspace, 'radar', 'by_region')).rejects.toThrow(
      /no query "by_region"/,
    )
  })
})

describe('check', () => {
  const file = () => join(fixture.root, 'dashboards/sales/index.tsx')

  it('passes a correct dashboard', async () => {
    const report = await checkDashboard(fixture.workspace, 'sales', file())
    expect(report.findings).toEqual([])
    expect(report.params).toMatchObject({ from: '0001-01-01', region: null })
    expect(report.queries.map((q) => q.rows)).toEqual([2, 1, 2])
  })

  it('catches a column the result does not have, and an unknown query', async () => {
    fixture.write(
      'dashboards/sales/index.tsx',
      DASHBOARD.replace('y="amount"', 'y="revenue"').replace('query="total"', 'query="totals"'),
    )
    const messages = (await checkDashboard(fixture.workspace, 'sales', file())).findings.map(
      (f) => f.message,
    )
    expect(messages).toContain(
      'column "revenue" is not in the result of "by_region" (has: region, amount)',
    )
    expect(messages).toContain('query "totals" is not defined in any .sql file of this dashboard')
    expect(messages).toContain('query "total" is defined but no panel uses it')
  })

  it('catches a parameter no filter provides', async () => {
    fixture.write(
      'dashboards/sales/queries.sql',
      `${QUERIES}\n-- name: orphan\nSELECT :plan AS plan\n`,
    )
    const report = await checkDashboard(fixture.workspace, 'sales', file())
    expect(report.findings.find((f) => f.severity === 'error')?.message).toBe(
      'query "orphan" uses :plan, which no filter provides',
    )
  })

  it('reports SQL errors with the file and line', async () => {
    fixture.write(
      'dashboards/sales/queries.sql',
      QUERIES.replace(
        'SUM(amount) AS amount FROM sales\nWHERE',
        'SUM(amount) AS amount FROM nope\nWHERE',
      ),
    )
    const error = (await checkDashboard(fixture.workspace, 'sales', file())).findings.find(
      (f) => f.severity === 'error',
    )
    expect(error?.message).toMatch(/query "total" failed: no such table: nope/)
    expect(error?.where).toBe('dashboards/sales/queries.sql:4')
  })
})

describe('comments', () => {
  it('writes a JSX comment above the panel, keeping its indentation', () => {
    const where = addComment(
      fixture.workspace.config,
      'sales',
      'By region',
      'split by month */ please',
    )
    const source = readFileSync(join(fixture.root, 'dashboards/sales/index.tsx'), 'utf8')
    expect(where).toEqual({ file: 'dashboards/sales/index.tsx', line: 14 })
    expect(source).toContain(
      '        {/* @dashboard-comment: split by month * / please */}\n        <BarChart title="By region"',
    )
    expect(listComments(fixture.workspace.config, 'sales')).toEqual([
      { line: 14, text: 'split by month * / please' },
    ])
    expect(analyzeDashboard(source).panels).toHaveLength(2)
  })

  it('refuses to splice into a file with a syntax error', () => {
    fixture.write('dashboards/sales/index.tsx', DASHBOARD.replace('</Row>', '</Rowx>'))
    expect(() => addComment(fixture.workspace.config, 'sales', 'By region', 'x')).toThrow(
      /syntax error/,
    )
  })

  it('names a panel it cannot find', () => {
    expect(() => addComment(fixture.workspace.config, 'sales', 'Nope', 'x')).toThrow(
      /no panel titled "Nope"/,
    )
  })
})

describe('sqlite file replaced underneath', () => {
  it('reopens when the path points at a new file', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const { renameSync } = await import('node:fs')
    expect((await runSql(fixture.workspace, 'SELECT count(*) AS n FROM sales')).rows[0]?.n).toBe(3)
    const next = join(fixture.root, 'next.db')
    const db = new DatabaseSync(next)
    db.exec(
      "CREATE TABLE sales (id INTEGER PRIMARY KEY, day TEXT, region TEXT, amount REAL); INSERT INTO sales (day, region, amount) VALUES ('2026-01-01', 'East', 1)",
    )
    db.close()
    renameSync(next, join(fixture.root, 'test.db'))
    expect((await runSql(fixture.workspace, 'SELECT count(*) AS n FROM sales')).rows[0]?.n).toBe(1)
  })
})

describe('drill checks', () => {
  it('warns about a drill into a filter the dashboard does not have', async () => {
    fixture.write(
      'dashboards/sales/index.tsx',
      DASHBOARD.replace('y="amount" />', 'y="amount" drill="channel" />'),
    )
    const report = await checkDashboard(
      fixture.workspace,
      'sales',
      join(fixture.root, 'dashboards/sales/index.tsx'),
    )
    expect(report.findings.map((f) => f.message)).toContain(
      '<BarChart "By region"> drills into "channel", but there is no <Select name="channel"> — clicks will do nothing',
    )
  })

  it('accepts a drill into an existing filter', async () => {
    fixture.write(
      'dashboards/sales/index.tsx',
      DASHBOARD.replace('y="amount" />', 'y="amount" drill="region" />'),
    )
    const report = await checkDashboard(
      fixture.workspace,
      'sales',
      join(fixture.root, 'dashboards/sales/index.tsx'),
    )
    expect(report.findings).toEqual([])
  })
})

describe('database.md', () => {
  it('reads databases/<source>/database.md for a configured source only', () => {
    expect(readDatabaseDoc(fixture.workspace.config, 'db')).toEqual({
      source: 'db',
      file: join('databases', 'db', 'database.md'),
      markdown: null,
      hash: '',
    })
    fixture.write('databases/db/database.md', '# db\n')
    expect(readDatabaseDoc(fixture.workspace.config, 'db').markdown).toBe('# db\n')
    expect(() => readDatabaseDoc(fixture.workspace.config, '../db')).toThrow(/unknown datasource/)
  })

  it('names the source a changed file documents', () => {
    const config = fixture.workspace.config
    expect(docSourceOf(config, join(config.root, 'databases/db/database.md'))).toBe('db')
    expect(docSourceOf(config, join(config.root, 'databases/db/other.md'))).toBeUndefined()
    expect(docSourceOf(config, join(config.root, 'dashboards/db/database.md'))).toBeUndefined()
  })
})

describe('source detail', () => {
  it('shows an API source by endpoint, without header values or tokens', async () => {
    fixture.write(
      'open-dashboard.config.mjs',
      `export default { datasources: { db: { type: 'sqlite', file: 'test.db' }, api: { type: 'http', baseUrl: 'https://api.example.com/v1', headers: { Authorization: 'Bearer sk-secret-123456' }, tables: { prices: { url: '/prices?date=:date&token=abc123secret', rows: 'data' } } } } }\n`,
    )
    await fixture.workspace.reconfigure(await loadConfig(fixture.root))
    const detail = await describeSource(fixture.workspace, 'api')
    expect(detail).toMatchObject({
      kind: 'http',
      base: 'https://api.example.com/v1',
      headers: ['Authorization'],
      endpoints: [{ table: 'prices', method: 'GET', rows: 'data', params: ['date'] }],
    })
    const text = JSON.stringify(detail)
    expect(text).not.toContain('sk-secret-123456')
    expect(text).not.toContain('abc123secret')
    expect(await describeSource(fixture.workspace, 'db')).toEqual({ kind: 'database' })
  })
})

describe('API tables and the result cache', () => {
  it('keys a result on parameters that only the table URL reads', async () => {
    const server = createServer((req, res) => {
      const stock = new URL(req.url ?? '/', 'http://x').searchParams.get('stock')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify([{ stock, close: stock === 'A' ? 10 : 20 }]))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      fixture.write(
        'open-dashboard.config.mjs',
        `export default { datasources: { api: { type: 'http', tables: { prices: { url: 'http://127.0.0.1:${port}/p?stock=:stock', cache: '1h' } } } }, cache: '1h' }\n`,
      )
      await fixture.workspace.reconfigure(await loadConfig(fixture.root))
      fixture.write('dashboards/quote/queries.sql', '-- name: close\nSELECT close FROM prices;\n')
      fixture.write(
        'dashboards/quote/index.tsx',
        'import { Dashboard, Filters, Select, Stat } from \'@open-dashboard/core\'\nexport default function Q() { return <Dashboard><Filters><Select name="stock" options={[\'A\', \'B\']} /></Filters><Stat title="Close" query="close" /></Dashboard> }\n',
      )
      const a = await runDashboardQuery(fixture.workspace, 'quote', 'close', { stock: 'A' })
      const b = await runDashboardQuery(fixture.workspace, 'quote', 'close', { stock: 'B' })
      expect(a.result.rows).toEqual([{ close: 10 }])
      expect(b.result.rows).toEqual([{ close: 20 }])
      const report = await checkDashboard(
        fixture.workspace,
        'quote',
        join(fixture.root, 'dashboards/quote/index.tsx'),
      )
      expect(report.queries.find((q) => q.name === 'close')?.error).toBeUndefined()
      fixture.write(
        'dashboards/quote/index.tsx',
        'import { Dashboard, Stat } from \'@open-dashboard/core\'\nexport default function Q() { return <Dashboard><Stat title="Close" query="close" /></Dashboard> }\n',
      )
      const unbound = await checkDashboard(
        fixture.workspace,
        'quote',
        join(fixture.root, 'dashboards/quote/index.tsx'),
      )
      expect(unbound.queries.find((q) => q.name === 'close')?.error).toMatch(
        /:stock, which no filter provides/,
      )
    } finally {
      server.close()
    }
  })
})

describe('writing database notes', () => {
  it('creates them, then refuses a write over a change made meanwhile', () => {
    const config = fixture.workspace.config
    const created = writeDatabaseDoc(config, 'db', '# db\n', '')
    expect(readDatabaseDoc(config, 'db')).toMatchObject({ markdown: '# db\n', hash: created.hash })
    expect(() => writeDatabaseDoc(config, 'db', '# other\n', '')).toThrow(
      /changed since it was read/,
    )
    writeDatabaseDoc(config, 'db', '# db, edited\n', created.hash)
    expect(readDatabaseDoc(config, 'db').markdown).toBe('# db, edited\n')
    expect(() => writeDatabaseDoc(config, 'nope', 'x')).toThrow(/unknown datasource/)
  })
})

describe('skills', () => {
  it('finds skills older than the package and updates only those', () => {
    fixture.write(
      '.claude/skills/create-dashboard/SKILL.md',
      '---\nname: create-dashboard\n---\nold\n',
    )
    fixture.write('.claude/skills/my-own/SKILL.md', '---\nname: my-own\n---\nmine\n')
    expect(staleSkills(fixture.root)).toEqual(['create-dashboard'])

    const names = syncSkills(fixture.root)
    expect(names).toContain('create-dashboard')
    expect(names).toContain('document-database')
    expect(staleSkills(fixture.root)).toEqual([])
    expect(readFileSync(join(fixture.root, '.claude/skills/my-own/SKILL.md'), 'utf8')).toContain(
      'mine',
    )
    expect(
      readFileSync(join(fixture.root, '.agents/skills/create-dashboard/SKILL.md'), 'utf8'),
    ).toContain('name: create-dashboard')
  })
})
