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

describe('collectors over json files', () => {
  async function withJson(collectors: string): Promise<Workspace> {
    fixture = await makeFixture()
    fixture.write('data/games.json', JSON.stringify([{ id: 1 }, { id: 2 }]))
    fixture.write('data/live.json', JSON.stringify({ items: [{ pitch: 1 }] }))
    fixture.write(
      'open-dashboard.config.mjs',
      `export default { datasources: { files: { type: 'json', tables: { games: { file: 'data/games.json' }, live: { file: 'data/live.json', rows: 'items' } } } }, collectors: ${collectors} }\n`,
    )
    workspace = new Workspace(await loadConfig(fixture.root))
    return workspace
  }
  const read = (path: string) => readFileSync(join(workspace?.config.root ?? '', path), 'utf8')
  const writes = (files: Record<string, string>) =>
    node(
      Object.entries(files)
        .map(
          ([path, text]) =>
            `require('fs').writeFileSync(${JSON.stringify(path)}, ${JSON.stringify(text)})`,
        )
        .join(';'),
    )

  it('puts back a file the run emptied or broke, and counts the run as failed', async () => {
    const ws = await withJson(
      `{ season: { run: ${writes({ 'data/games.json': '[]', 'data/live.json': '{"items": [' })}, source: 'files' } }`,
    )
    const run = await runCollector(ws, 'season')
    expect(run.ok).toBe(false)
    expect(run.kept).toEqual(['data/games.json', 'data/live.json'])
    expect(run.output).toContain('kept the previous data/games.json: the new one had no rows')
    expect(run.output).toContain('data/live.json: the new one is not valid JSON')
    expect(JSON.parse(read('data/games.json'))).toEqual([{ id: 1 }, { id: 2 }])
    expect(JSON.parse(read('data/live.json')).items).toHaveLength(1)
  })

  it('writes through new rows, and an empty table the config allows', async () => {
    const ws = await withJson(
      `{ live: { run: ${writes({ 'data/games.json': '[{"id":3}]', 'data/live.json': '{"items": []}' })}, source: 'files', allowEmpty: ['live'] } }`,
    )
    const run = await runCollector(ws, 'live')
    expect(run.ok).toBe(true)
    expect(run.kept).toBeUndefined()
    expect(JSON.parse(read('data/games.json'))).toEqual([{ id: 3 }])
    expect(JSON.parse(read('data/live.json'))).toEqual({ items: [] })
  })
})
