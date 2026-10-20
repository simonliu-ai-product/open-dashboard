import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from './workspace.js'

const before = process.env.TZ
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'odd-tz-'))
})

afterEach(() => {
  if (before === undefined) delete process.env.TZ
  else process.env.TZ = before
  rmSync(root, { recursive: true, force: true })
})

const configWith = (timeZone: string) =>
  writeFileSync(
    join(root, 'open-dashboard.config.mjs'),
    `export default { timeZone: ${JSON.stringify(timeZone)}, datasources: {} }\n`,
  )

describe('timeZone', () => {
  /* A build stamps the workspace's wall clock, not the machine's: 15:00 UTC is 23:00 in Taipei. */
  it('sets the wall clock the process reads', async () => {
    configWith('Asia/Taipei')
    const config = await loadConfig(root)
    expect(config.timeZone).toBe('Asia/Taipei')
    expect(new Date('2026-10-19T15:00:00Z').getHours()).toBe(23)
  })

  it('refuses a name that is not a time zone', async () => {
    configWith('Taipei Time')
    await expect(loadConfig(root)).rejects.toThrow(/is not an IANA time zone/)
  })
})
