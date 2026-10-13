import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Fixture, makeFixture } from '../ops/fixture.test-helper.js'
import { loadConfig, Workspace } from '../workspace.js'
import { hostAllowed, serveHandler } from './serve.js'

const DASHBOARD = `import { Dashboard, Table } from '@open-dashboard/core'
export const meta = { title: 'Sales' }
export default function Sales() {
  return <Dashboard><Table title="By region" query="by_region" /></Dashboard>
}
`
const QUERIES = `-- name: by_region
SELECT region, SUM(amount) AS amount FROM sales GROUP BY region ORDER BY region
`

let fixture: Fixture | undefined
let server: Server | undefined
afterEach(async () => {
  server?.closeAllConnections()
  await new Promise((done) => (server ? server.close(done) : done(undefined)))
  await fixture?.cleanup()
  server = undefined
  fixture = undefined
})

/** The handler over a fixture, with a stand-in viewer bundle: no Vite build needed. */
async function start(config = ''): Promise<{ url: string; workspace: Workspace }> {
  fixture = await makeFixture({
    'dashboards/sales/index.tsx': DASHBOARD,
    'dashboards/sales/queries.sql': QUERIES,
  })
  if (config) fixture.write('open-dashboard.config.mjs', config)
  const workspace = config ? new Workspace(await loadConfig(fixture.root)) : fixture.workspace
  const dir = join(fixture.root, 'viewer')
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'main-abc.js'), 'console.log(1)')
  writeFileSync(join(fixture.root, 'secret.txt'), 'nope')
  const handler = serveHandler(workspace, { dir, file: 'assets/main-abc.js', css: [] })
  const listening = createServer((req, res) => void handler(req, res))
  server = listening
  await new Promise<void>((done) => listening.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${(listening.address() as AddressInfo).port}`, workspace }
}

describe('serve', () => {
  it('serves the viewer page and its hashed assets', async () => {
    const { url } = await start()
    const page = await fetch(`${url}/d/sales`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('window.__ODD_SERVED__=true')
    expect(html).toContain('src="/assets/main-abc.js"')
    const asset = await fetch(`${url}/assets/main-abc.js`)
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect(await asset.text()).toBe('console.log(1)')
  })

  it('never hands out a file outside the bundle', async () => {
    const { url } = await start()
    for (const path of [
      '/assets/../../secret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '/test.db',
    ]) {
      const response = await fetch(`${url}${path}`)
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain('nope')
    }
  })

  it('runs named queries without SQL or paths in the reply, and ignores fresh', async () => {
    const { url, workspace } = await start()
    const ask = () =>
      fetch(`${url}/__odd/api/query?id=sales&name=by_region&params=%7B%7D&fresh=1`).then(
        (r) =>
          r.json() as Promise<{
            query: { sql: string; file: string }
            result: { rows: unknown[] }
            ranAt: string
          }>,
      )
    const first = await ask()
    expect(first.result.rows).toEqual([
      { region: 'North', amount: 40 },
      { region: 'South', amount: 20 },
    ])
    expect(first.query.sql).toBe('')
    expect(first.query.file).toBe('')
    expect((await ask()).ranAt).toBe(first.ranAt)
    const list = (await fetch(`${url}/__odd/api/dashboards`).then((r) => r.json())) as {
      dashboards: { id: string; file: string }[]
    }
    expect(list.dashboards).toMatchObject([{ id: 'sales', file: '' }])
    expect(workspace.config.serve.assistant).toBe(false)
  })

  it('offers nothing that writes, edits or shows the source', async () => {
    const { url } = await start()
    for (const route of [
      'queries?id=sales',
      'layout?id=sales',
      'sources',
      'schema',
      'collectors',
      'comments?id=sales',
      'export-html?id=sales',
      'query-history?id=sales&name=by_region',
    ]) {
      expect((await fetch(`${url}/__odd/api/${route}`)).status).toBe(404)
    }
    for (const route of ['layout', 'comment', 'collect', 'theme', 'current']) {
      const response = await fetch(`${url}/__odd/api/${route}`, { method: 'POST', body: '{}' })
      expect(response.status).toBe(405)
    }
  })

  it('keeps the assistant off unless serve.assistant turns it on', async () => {
    const { url } = await start()
    expect(await fetch(`${url}/__odd/api/assistant`).then((r) => r.json())).toEqual({
      enabled: false,
    })
    const asked = await fetch(`${url}/__odd/api/assistant`, {
      method: 'POST',
      body: JSON.stringify({ id: 'sales', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(asked.status).toBe(404)
  })

  it('refuses a cross-origin call and a host it was not told about', async () => {
    const { url } = await start(
      `export default { datasources: { db: { type: 'sqlite', file: 'test.db' } }, serve: { allowedHosts: ['.run.app'] } }\n`,
    )
    const cross = await fetch(`${url}/__odd/api/dashboards`, {
      headers: { Origin: 'https://evil.example' },
    })
    expect(cross.status).toBe(403)
    expect(hostAllowed('dash-123.a.run.app', ['.run.app'])).toBe(true)
    expect(hostAllowed('localhost:8080', [])).toBe(true)
    expect(hostAllowed('[::1]:5473', [])).toBe(true)
    expect(hostAllowed('evil.example', ['.run.app'])).toBe(false)
    expect(hostAllowed('run.app.evil.example', ['.run.app'])).toBe(false)
    expect(hostAllowed(undefined, ['.run.app'])).toBe(false)
  })
})
