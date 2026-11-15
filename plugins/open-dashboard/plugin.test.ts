import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname
const core = join(here, '..', '..', 'packages', 'core', 'skills')
const plugin = join(here, 'skills')

const files = (dir: string, base = ''): string[] =>
  readdirSync(join(dir, base)).flatMap((n) =>
    statSync(join(dir, base, n)).isDirectory() ? files(dir, join(base, n)) : [join(base, n)],
  )

describe('agent plugin', () => {
  it('ships the canonical skills unchanged (run node scripts/sync-plugin.mjs)', () => {
    expect(files(plugin).sort()).toEqual(files(core).sort())
    for (const f of files(core))
      expect(readFileSync(join(plugin, f), 'utf8'), f).toBe(readFileSync(join(core, f), 'utf8'))
  })

  it('declares the same version for Claude Code and Antigravity', () => {
    const a = JSON.parse(readFileSync(join(here, 'plugin.json'), 'utf8'))
    const b = JSON.parse(readFileSync(join(here, '.claude-plugin', 'plugin.json'), 'utf8'))
    expect(a.version).toBe(b.version)
    expect(a.name).toBe(b.name)
  })
})
