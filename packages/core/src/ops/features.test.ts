import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildGcloudDeployArgs,
  defaultBucketName,
  formatAntigravityMcpSnippet,
  generateDockerfile,
  generateEntrypointScript,
  sanitizeKebab,
} from '../cli/deploy-gcp.js'
import { openFiles, parseMarkdownTable } from '../datasource/files.js'
import { loadQueries, loadSharedQueries } from '../queries/load.js'
import { parseQueryFile } from '../queries/parse.js'
import { resultToCsv } from '../runtime/export-panel.js'
import {
  isCustomTimeRange,
  isTimeValue,
  resolvePreviousRange,
  resolveTimeRange,
  timeRangeParams,
} from '../runtime/time-range.js'
import { loadConfig, Workspace } from '../workspace.js'
import { evaluateAlerts } from './alerts.js'
import { analyzeDashboard } from './analyze.js'
import { readWorkspaceChanges, revertWorkspaceFile } from './changes.js'
import { readSharedQueryFiles, writeSharedQueryFile } from './dashboard-files.js'
import { diffWorkspace } from './diff.js'
import { explainDashboardQuery } from './explain.js'
import { generateReport } from './report.js'

describe('Feature 1: Interactive Filters & Custom/Compare Time Ranges', () => {
  const now = new Date(2026, 9, 10, 12, 0)

  it('recognizes custom YYYY-MM-DD..YYYY-MM-DD ranges and normalizes reversed bounds', () => {
    expect(isCustomTimeRange('2026-03-01..2026-03-10')).toBe(true)
    expect(isTimeValue('2026-03-01..2026-03-10')).toBe(true)
    expect(isCustomTimeRange('2026-03-01')).toBe(false)
    expect(resolveTimeRange('2026-03-10..2026-03-01', now)).toEqual({
      from: '2026-03-01',
      to: '2026-03-10',
    })
  })

  it('computes equal-length previous period and binds :prev_from / :prev_to when compare=true', () => {
    expect(resolvePreviousRange('2026-03-11', '2026-03-21')).toEqual({
      prevFrom: '2026-03-01',
      prevTo: '2026-03-11',
    })
    const params = timeRangeParams(undefined, '2026-03-11..2026-03-21', now, true)
    expect(params).toEqual({
      from: '2026-03-11',
      to: '2026-03-21',
      prev_from: '2026-03-01',
      prev_to: '2026-03-11',
    })
  })

  it('analyzes SearchInput, Toggle, MultiSelect, TimeRange compare, and Tabs/Tab components', () => {
    const analysis = analyzeDashboard(
      `
      import { Dashboard, TimeRange, SearchInput, Toggle, MultiSelect, Tabs, Tab, Row, Stat } from '@open-dashboard/core'
      export default (
        <Dashboard>
          <TimeRange default="30d" compare allowCustom />
          <SearchInput name="q" label="Keyword" default="pro" />
          <Toggle name="active_only" label="Active only" default={true} />
          <MultiSelect name="region" label="Regions" options={['North', 'South']} default={['North', 'South']} />
          <Tabs default="overview">
            <Tab id="overview" label="Overview">
              <Row><Stat title="Total" query="headline" /></Row>
            </Tab>
          </Tabs>
        </Dashboard>
      )
      `,
    )
    expect(analysis.filters.map((f) => [f.kind, f.name, f.default, f.compare])).toEqual([
      ['TimeRange', undefined, '30d', true],
      ['SearchInput', 'q', 'pro', undefined],
      ['Toggle', 'active_only', '1', undefined],
      ['MultiSelect', 'region', 'North,South', undefined],
    ])
    expect(analysis.panels).toHaveLength(1)
    expect(analysis.panels[0]?.query).toBe('headline')
  })
})

describe('Feature 2: CSV / JSON Data Export', () => {
  it('serializes QueryResult rows to RFC 4180 CSV with proper escaping', () => {
    const csv = resultToCsv({
      columns: [{ name: 'customer' }, { name: 'note' }, { name: 'mrr' }],
      rows: [
        { customer: 'Acme, Inc.', note: 'Said "hello"', mrr: 1200 },
        { customer: 'Beta', note: null, mrr: 450 },
      ],
    })
    expect(csv).toBe('customer,note,mrr\r\n"Acme, Inc.","Said ""hello""",1200\r\nBeta,,450')
  })
})

describe('Feature 4: Query Alerts & Snapshot Diff', () => {
  it('parses -- alert: headers and evaluates alert rules against query results', () => {
    const [q] = parseQueryFile(
      `-- name: churn_check
-- alert: churn_rate > 0.05 Monthly churn exceeded 5%
-- alert: active_orgs < 10
SELECT 0.08 AS churn_rate, 12 AS active_orgs;
`,
      'queries.sql',
    )
    expect(q?.alerts).toEqual(['churn_rate > 0.05 Monthly churn exceeded 5%', 'active_orgs < 10'])

    const evaluated = evaluateAlerts(
      {
        columns: [
          { name: 'churn_rate', type: 'number' },
          { name: 'active_orgs', type: 'number' },
        ],
        rows: [{ churn_rate: 0.082, active_orgs: 12 }],
        elapsedMs: 1,
        truncated: false,
      },
      q?.alerts,
    )
    const triggered = evaluated.filter((a) => a.triggered)
    expect(triggered).toHaveLength(1)
    expect(triggered[0]?.message).toBe('Monthly churn exceeded 5%')
    expect(triggered[0]?.actual).toBe(0.082)
  })
})

describe('Feature 5 & Batch 2: Markdown Datasource, Shared Queries, Explain, Diff & Report', () => {
  it('parses GitHub-flavored Markdown pipe tables into typed rows', () => {
    const md = `
# Quarterly Targets

| quarter | target_mrr | stretch_mrr | owner |
| :--- | ---: | ---: | :---: |
| 2026-Q1 | 25000 | 30000 | Alice |
| 2026-Q2 | 32000 | 38000 | Bob |
`
    const parsed = parseMarkdownTable(md)
    expect(parsed).toEqual([
      ['quarter', 'target_mrr', 'stretch_mrr', 'owner'],
      ['2026-Q1', '25000', '30000', 'Alice'],
      ['2026-Q2', '32000', '38000', 'Bob'],
    ])
  })

  it('loads .md tables, inherits shared queries/*.sql, explains plans, diffs snapshots, and generates reports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'odd-feat-'))
    try {
      await mkdir(join(root, 'data'), { recursive: true })
      await mkdir(join(root, 'queries'), { recursive: true })
      await mkdir(join(root, 'dashboards', 'goals'), { recursive: true })
      await writeFile(
        join(root, 'data', 'targets.md'),
        `| quarter | target |\n| --- | --- |\n| Q1 | 100 |\n| Q2 | 200 |\n`,
      )
      await writeFile(
        join(root, 'queries', 'shared.sql'),
        `-- name: shared_summary\n-- source: targets\n-- alert: total_target < 500 Annual target below 500\nSELECT SUM(target) AS total_target, COUNT(*) AS quarters FROM targets;\n`,
      )
      await writeFile(
        join(root, 'open-dashboard.config.mjs'),
        `export default {
          datasources: {
            targets: { type: 'csv', tables: { targets: { file: './data/targets.md' } } },
          },
        }\n`,
      )
      await writeFile(
        join(root, 'dashboards', 'goals', 'index.tsx'),
        `import { Dashboard, Row, Stat, Table } from '@open-dashboard/core'
        export const meta = { title: 'Goals' }
        export default (
          <Dashboard>
            <Row><Stat title="Total Target" query="shared_summary" value="total_target" /></Row>
            <Row><Table title="Targets" query="all_targets" /></Row>
          </Dashboard>
        )\n`,
      )
      await writeFile(
        join(root, 'dashboards', 'goals', 'queries.sql'),
        `-- name: all_targets\n-- source: targets\nSELECT quarter, target FROM targets ORDER BY quarter;\n`,
      )

      const shared = loadSharedQueries(root)
      expect([...shared.keys()]).toEqual(['shared_summary'])
      const merged = loadQueries(join(root, 'dashboards', 'goals'), root)
      expect([...merged.keys()].sort()).toEqual(['all_targets', 'shared_summary'])

      const ds = await openFiles(
        'targets',
        { type: 'csv', tables: { targets: { file: './data/targets.md' } } },
        root,
      )
      const res = await ds.query(
        'SELECT quarter, target FROM targets ORDER BY quarter',
        {},
        { maxRows: 100, timeoutMs: 5000 },
      )
      expect(res.rows).toEqual([
        { quarter: 'Q1', target: 100 },
        { quarter: 'Q2', target: 200 },
      ])
      await ds.close?.()

      const workspace = new Workspace(await loadConfig(root))
      try {
        const plan = await explainDashboardQuery(workspace, 'goals', 'all_targets')
        expect(plan.source).toBe('targets')
        expect(plan.steps.length).toBeGreaterThan(0)

        const report = await generateReport(workspace, 'goals')
        expect(report.dashboards).toHaveLength(1)
        expect(report.alertsTriggered).toBe(1)
        expect(report.dashboards[0]?.alerts).toHaveLength(1)
        expect(report.markdown).toContain('## Goals (`goals`)')
        expect(report.markdown).toContain('Annual target below 500')

        const snapDir = join(root, 'dist', 'data', 'd', 'goals')
        await mkdir(snapDir, { recursive: true })
        await writeFile(
          join(snapDir, 'all_targets.json'),
          JSON.stringify({
            reads: [],
            results: {
              '': {
                query: 'all_targets',
                source: 'targets',
                params: {},
                result: {
                  columns: [
                    { name: 'quarter', type: 'text' },
                    { name: 'target', type: 'number' },
                  ],
                  rows: [{ quarter: 'Q1', target: 100 }],
                  elapsedMs: 1,
                  truncated: false,
                },
              },
            },
          }),
        )

        const diff = await diffWorkspace(workspace, join(root, 'dist'))
        const allTargetsDiff = diff.find((d) => d.query === 'all_targets')
        expect(allTargetsDiff?.status).toBe('changed')
        expect(allTargetsDiff?.beforeRows).toBe(1)
        expect(allTargetsDiff?.afterRows).toBe(2)
      } finally {
        await workspace.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Phase 3: Shared Queries API, Git Changes & GCP Deploy Helpers', () => {
  it('reads and writes shared query files in queries/*.sql', async () => {
    const root = await mkdtemp(join(tmpdir(), 'odd-shared-'))
    try {
      const config = await loadConfig(root)
      const written = writeSharedQueryFile(
        config,
        'common.sql',
        '-- name: active_regions\nSELECT 1 AS id;\n',
      )
      expect(written.file).toBe('queries/common.sql')
      expect(written.created).toBe(true)
      const read = readSharedQueryFiles(config)
      expect(read.files).toHaveLength(1)
      expect(read.files[0]?.name).toBe('common.sql')
      expect(read.files[0]?.content).toContain('active_regions')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('tracks uncommitted workspace git changes and reverts modified or untracked files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'odd-git-'))
    try {
      const config = await loadConfig(root)
      execFileSync('git', ['init', '-q'], { cwd: root })
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root })
      await mkdir(join(root, 'dashboards', 'demo'), { recursive: true })
      await writeFile(join(root, 'dashboards', 'demo', 'queries.sql'), '-- name: q1\nSELECT 1;\n')
      execFileSync('git', ['add', '-A'], { cwd: root })
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root })

      // Modify tracked file + add untracked file
      await writeFile(join(root, 'dashboards', 'demo', 'queries.sql'), '-- name: q1\nSELECT 2;\n')
      await writeFile(join(root, 'dashboards', 'demo', 'extra.sql'), '-- name: q2\nSELECT 3;\n')

      const before = await readWorkspaceChanges(config)
      expect(before.available).toBe(true)
      expect(before.files.map((f) => [f.path, f.status])).toEqual([
        ['dashboards/demo/extra.sql', 'added'],
        ['dashboards/demo/queries.sql', 'modified'],
      ])

      await revertWorkspaceFile(config, 'dashboards/demo/queries.sql')
      const afterRevert1 = await readWorkspaceChanges(config)
      expect(afterRevert1.files.map((f) => f.path)).toEqual(['dashboards/demo/extra.sql'])

      await revertWorkspaceFile(config, 'dashboards/demo/extra.sql')
      const afterRevert2 = await readWorkspaceChanges(config)
      expect(afterRevert2.files).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('generates Cloud Run Dockerfile, entrypoint, deploy args, and Antigravity MCP config', () => {
    expect(sanitizeKebab('@my-org/Sales_Dashboard!')).toBe('sales-dashboard')
    expect(defaultBucketName('my-gcp-proj', 'sales-board')).toBe('my-gcp-proj-sales-board-data')

    const dockerfile = generateDockerfile({
      packageManager: 'pnpm',
      syncedDirs: ['dashboards', 'queries'],
      mode: 'editable',
    })
    expect(dockerfile).toContain('FROM node:22-slim')
    expect(dockerfile).toContain('OPEN_DASHBOARD_CLOUD=1')

    const entrypoint = generateEntrypointScript({
      syncedDirs: ['dashboards', 'queries'],
      mode: 'editable',
    })
    expect(entrypoint).toContain('npx open-dashboard dev --host 0.0.0.0')

    const args = buildGcloudDeployArgs({
      userCwd: '/tmp/app',
      dashboardsDir: 'dashboards',
      chartsDir: 'charts',
      syncedDirs: ['dashboards', 'queries'],
      project: 'demo-proj',
      region: 'asia-east1',
      service: 'demo-board',
      bucket: 'demo-proj-demo-board-data',
      mode: 'editable',
      memory: '1Gi',
      mcpToken: 'odd_mcp_secret',
      packageManager: 'pnpm',
    })
    expect(args).toContain('--execution-environment')
    expect(args).toContain(
      'name=open-dashboard-storage,type=cloud-storage,bucket=demo-proj-demo-board-data',
    )

    const snippet = JSON.parse(
      formatAntigravityMcpSnippet('demo-board', 'https://demo-board.run.app/', 'odd_mcp_secret'),
    )
    expect(snippet.mcpServers['demo-board-cloud']).toEqual({
      serverUrl: 'https://demo-board.run.app/mcp',
      headers: { Authorization: 'Bearer odd_mcp_secret' },
    })
  })
})
