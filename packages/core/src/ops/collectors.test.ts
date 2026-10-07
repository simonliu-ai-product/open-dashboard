import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig, Workspace } from '../workspace.js'
import {
  collectorStatePath,
  listCollectors,
  runCollector,
  scheduleCollectors,
} from './collectors.js'
import { type Fixture, makeFixture } from './fixture.test-helper.js'

let fixture: Fixture | undefined
let workspace: Workspace | undefined
afterEach(async () => {
  await workspace?.close()
  await fixture?.cleanup()
  fixture = undefined
  workspace = undefined
})

async function withCollectors(collectors: string): Promise<Workspace> {
  fixture = await makeFixture()
  fixture.write(
    'open-dashboard.config.mjs',
    `export default { datasources: { db: { type: 'sqlite', file: 'test.db' } }, collectors: ${collectors} }\n`,
  )
  workspace = new Workspace(await loadConfig(fixture.root))
  return workspace
}

const node = (code: string) => JSON.stringify([process.execPath, '-e', code])

describe('collectors', () => {
  it('runs a command from the config, records it and clears cached results', async () => {
    const ws = await withCollectors(
      `{ fill: { run: ${node("require('fs').writeFileSync('filled.txt', 'yes'); console.log('42 rows')")}, source: 'db', every: '1h' } }`,
    )
    ws.cache.set('k', 'x', Promise.resolve({} as never), 60_000)
    const run = await runCollector(ws, 'fill')
    expect(run.ok).toBe(true)
    expect(run.output).toBe('42 rows')
    expect(readFileSync(join(ws.config.root, 'filled.txt'), 'utf8')).toBe('yes')
    expect(ws.cache.get('k')).toBeUndefined()
    expect(existsSync(collectorStatePath(ws.config))).toBe(true)
    const [status] = listCollectors(ws)
    expect(status).toMatchObject({ id: 'fill', source: 'db', every: '1h', running: false })
    expect(status?.last?.ok).toBe(true)
    expect(Date.parse(status?.next ?? '')).toBeGreaterThan(Date.now())
  })

  it('reports a failure with its output masked', async () => {
    // A key from .env, which the collector reads and might echo.
    process.env.COLLECT_API_TOKEN = 's3cr3t-token-value'
    const ws = await withCollectors(
      `{ broken: { run: ${node("console.error('auth failed for s3cr3t-token-value'); process.exit(3)")} } }`,
    )
    const run = await runCollector(ws, 'broken')
    expect(run.ok).toBe(false)
    expect(run.exitCode).toBe(3)
    expect(run.output).toContain('auth failed')
    expect(run.output).not.toContain('s3cr3t-token-value')
    delete process.env.COLLECT_API_TOKEN
  })

  it('joins a run already going instead of starting another', async () => {
    const ws = await withCollectors(`{ slow: { run: ${node('setTimeout(() => {}, 200)')} } }`)
    const first = runCollector(ws, 'slow')
    expect(listCollectors(ws)[0]?.running).toBe(true)
    expect(runCollector(ws, 'slow')).toBe(first)
    await first
    expect(listCollectors(ws)[0]?.running).toBe(false)
  })

  it('stops a run that outlasts its timeout', async () => {
    const ws = await withCollectors(
      `{ hang: { run: ${node('setTimeout(() => {}, 60000)')}, timeout: '200ms' } }`,
    )
    const run = await runCollector(ws, 'hang')
    expect(run.ok).toBe(false)
    expect(run.output).toContain('stopped after')
  })

  it('runs only collectors named in the config', async () => {
    const ws = await withCollectors(`{}`)
    expect(() => runCollector(ws, 'rm -rf /')).toThrow(/no collector/)
  })

  it('refuses a config with a bad schedule', async () => {
    fixture = await makeFixture()
    fixture.write(
      'open-dashboard.config.mjs',
      `export default { datasources: {}, collectors: { x: { run: 'true', every: 'hourly' } } }\n`,
    )
    await expect(loadConfig(fixture.root)).rejects.toThrow(/not a duration/)
  })

  it('schedules a collector that is due, and not one that is not', async () => {
    const ws = await withCollectors(
      `{ due: { run: ${node('')}, every: '1h' }, manual: { run: ${node('')} } }`,
    )
    const ran: string[] = []
    await new Promise<void>((resolve) => {
      const stop = scheduleCollectors(ws, (id) => {
        ran.push(id)
        stop()
        resolve()
      })
    })
    expect(ran).toEqual(['due'])
  })
})
