import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { init } from './init.js'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'odd-init-'))
})

afterEach(() => rmSync(cwd, { recursive: true, force: true }))

describe('init', () => {
  it('scaffolds an empty workspace with skills and a pinned framework', async () => {
    const result = await init({ directory: 'board', cwd, version: '^9.9.9' })
    const root = join(cwd, 'board')

    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.name).toBe('board')
    expect(pkg.dependencies['@open-dashboard/core']).toBe('^9.9.9')

    for (const file of [
      '.gitignore',
      '.env.example',
      'AGENTS.md',
      'CLAUDE.md',
      'open-dashboard.config.ts',
    ]) {
      expect(existsSync(join(root, file))).toBe(true)
    }
    expect(existsSync(join(root, 'gitignore'))).toBe(false)
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain('.env')

    for (const dir of ['.claude/skills', '.agents/skills']) {
      for (const skill of [
        'create-dashboard',
        'dashboard-authoring',
        'connect-database',
        'current-dashboard',
        'apply-comments',
        'document-database',
      ]) {
        expect(existsSync(join(root, dir, skill, 'SKILL.md'))).toBe(true)
      }
    }
    expect(existsSync(join(root, 'skills'))).toBe(false)

    // A new workspace starts at "connect a database": no data, no dashboards.
    expect(existsSync(join(root, 'data', 'sample.db'))).toBe(false)
    expect(result.files.filter((f) => f.startsWith('dashboards/'))).toEqual([])
    const config = readFileSync(join(root, 'open-dashboard.config.ts'), 'utf8')
    expect(config).not.toContain('sample:')
    expect(config).toContain('datasources: {')
  })

  it('adds the sample database and its dashboard with --sample', async () => {
    const result = await init({ directory: 'demo', cwd, sample: true })
    const root = join(cwd, 'demo')
    const db = new DatabaseSync(join(root, 'data', 'sample.db'), { readOnly: true })
    const { n } = db.prepare('SELECT count(*) AS n FROM orders').get() as { n: number }
    db.close()
    expect(n).toBeGreaterThan(1000)
    expect(result.files).toContain('dashboards/getting-started/queries.sql')
    expect(readFileSync(join(root, 'open-dashboard.config.ts'), 'utf8')).toContain(
      "sample: { type: 'sqlite', file: 'data/sample.db' },",
    )
  })

  it('refuses a directory that is not empty', async () => {
    await init({ directory: 'taken', cwd })
    await expect(init({ directory: 'taken', cwd })).rejects.toThrow(/not empty/)
  })
})
