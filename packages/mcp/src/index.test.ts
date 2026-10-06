import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadConfig, Workspace } from '@open-dashboard/core/node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createOpenDashboardMcpHandler } from './index.js'

let root: string
let workspace: Workspace

beforeEach(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'odd-mcp-')))
  const db = new DatabaseSync(join(root, 'shop.db'))
  db.exec(
    "CREATE TABLE orders (region TEXT, total REAL); INSERT INTO orders VALUES ('North', 40), ('South', 20);",
  )
  db.close()
  writeFileSync(
    join(root, 'open-dashboard.config.mjs'),
    "export default { datasources: { shop: { type: 'sqlite', file: 'shop.db' } } }\n",
  )
  mkdirSync(join(root, 'dashboards', 'sales'), { recursive: true })
  writeFileSync(
    join(root, 'dashboards', 'sales', 'index.tsx'),
    'import { Dashboard, Stat } from \'@open-dashboard/core\'\nexport default function S() { return <Dashboard><Stat title="Total" query="total" /></Dashboard> }\n',
  )
  writeFileSync(
    join(root, 'dashboards', 'sales', 'queries.sql'),
    '-- name: total\nSELECT SUM(total) AS total FROM orders;\n',
  )
  workspace = new Workspace(await loadConfig(root, {}))
})

afterEach(async () => {
  await workspace.close()
  rmSync(root, { recursive: true, force: true })
})

async function rpc(
  allowSql: boolean,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const handler = createOpenDashboardMcpHandler({ workspace, allowSql })
  const response = await handler.fetch(
    new Request('http://localhost:5473/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        // A real client always sends Host; a Request built in a test does not.
        Host: 'localhost:5473',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  if (!response.ok) return { status: response.status }
  const text = await response.text()
  const data = text.includes('data:')
    ? (
        text
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .at(-1) as string
      ).slice(5)
    : text
  return { status: response.status, body: JSON.parse(data) }
}

async function tool(name: string, args: Record<string, unknown>, allowSql = false) {
  const { body } = await rpc(allowSql, 'tools/call', { name, arguments: args })
  const result = body.result as { isError?: boolean; content: { text: string }[] }
  const text = result.content[0]?.text ?? ''
  return { error: result.isError === true, text }
}

describe('MCP server', () => {
  it('offers run_sql only when allowed', async () => {
    const names = async (allowSql: boolean) =>
      ((await rpc(allowSql, 'tools/list')).body.result.tools as { name: string }[]).map(
        (t) => t.name,
      )
    expect(await names(false)).toContain('write_dashboard_file')
    expect(await names(false)).not.toContain('run_sql')
    expect(await names(true)).toContain('run_sql')
  })

  it('runs a named query as a panel would', async () => {
    const result = await tool('run_query', { dashboard: 'sales', query: 'total' })
    expect(JSON.parse(result.text).rows).toEqual([{ total: 60 }])
  })

  it('writes a dashboard file, and refuses a stale or stray write', async () => {
    const read = JSON.parse((await tool('read_dashboard', { id: 'sales' })).text)
    const index = read.files.find((f: { name: string }) => f.name === 'index.tsx')
    const changed = index.content.replace('Total', 'Revenue')
    const ok = await tool('write_dashboard_file', {
      id: 'sales',
      file: 'index.tsx',
      content: changed,
      expected: index.hash,
    })
    expect(ok.error).toBe(false)
    const stale = await tool('write_dashboard_file', {
      id: 'sales',
      file: 'index.tsx',
      content: 'x',
      expected: index.hash,
    })
    expect(stale).toMatchObject({ error: true, text: expect.stringMatching(/^409: /) })
    const stray = await tool('write_dashboard_file', {
      id: 'sales',
      file: '../escape.ts',
      content: 'x',
    })
    expect(stray).toMatchObject({
      error: true,
      text: expect.stringMatching(/not a dashboard file/),
    })
    const created = await tool('write_dashboard_file', {
      id: 'new-one',
      file: 'queries.sql',
      content: '-- name: q\nSELECT 1;\n',
    })
    expect(JSON.parse(created.text)).toMatchObject({ created: true })
  })

  it('runs the agent’s SQL read-only', async () => {
    const select = await tool('run_sql', { sql: 'SELECT COUNT(*) AS n FROM orders' }, true)
    expect(JSON.parse(select.text).rows).toEqual([{ n: 2 }])
    const write = await tool('run_sql', { sql: 'DELETE FROM orders' }, true)
    expect(write.error).toBe(true)
    const after = await tool('run_sql', { sql: 'SELECT COUNT(*) AS n FROM orders' }, true)
    expect(JSON.parse(after.text).rows).toEqual([{ n: 2 }])
  })

  it('refuses a page on another origin, and another host name', async () => {
    expect((await rpc(false, 'tools/list', {}, { Origin: 'https://evil.example' })).status).toBe(
      403,
    )
    expect((await rpc(false, 'tools/list', {}, { Host: 'evil.example' })).status).toBe(403)
  })
})
