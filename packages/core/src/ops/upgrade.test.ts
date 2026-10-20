import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { admits, upgradeWorkspace } from './upgrade.js'

let root: string
const write = (path: string, content: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), content)
}
const pkg = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'odd-upgrade-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('admits', () => {
  it('reads ranges the way pnpm does for 0.x', () => {
    expect(admits('^0.7.1', '0.7.9')).toBe(true)
    expect(admits('^0.7.1', '0.12.0')).toBe(false)
    expect(admits('^1.2.0', '1.9.0')).toBe(true)
    expect(admits('~1.2.0', '1.3.0')).toBe(false)
    expect(admits('0.12.0', '0.12.0')).toBe(true)
    expect(admits('latest', '0.12.0')).toBeUndefined()
  })
})

describe('upgradeWorkspace', () => {
  /* A workspace that stayed on ^0.7.1, patching core 0.7.1 locally instead of upgrading. */
  it('finds a range that would install the old version back, and a patch that no longer applies', () => {
    write('package.json', JSON.stringify({ dependencies: { '@open-dashboard/core': '^0.7.1' } }))
    write(
      'pnpm-workspace.yaml',
      "patchedDependencies:\n  '@open-dashboard/core@0.7.1': patches/@open-dashboard__core@0.7.1.patch\n",
    )
    const report = upgradeWorkspace(root, '0.12.0')
    expect(report.from).toBeUndefined()
    expect(report.steps.map((s) => [s.id, s.status])).toEqual([
      ['skills', 'ok'],
      ['version-range', 'needed'],
      ['local-patch', 'manual'],
      ['record-version', 'needed'],
    ])
    expect(pkg().dependencies['@open-dashboard/core']).toBe('^0.7.1')
  })

  it('does the needed steps with write, and leaves the patch to the user', () => {
    write('package.json', JSON.stringify({ dependencies: { '@open-dashboard/core': '^0.7.1' } }))
    const report = upgradeWorkspace(root, '0.12.0', { write: true })
    expect(report.steps.filter((s) => s.applied).map((s) => s.id)).toEqual([
      'version-range',
      'record-version',
    ])
    expect(pkg()).toEqual({
      dependencies: { '@open-dashboard/core': '^0.12.0' },
      openDashboard: { version: '0.12.0' },
    })
    expect(upgradeWorkspace(root, '0.12.0').steps.every((s) => s.status === 'ok')).toBe(true)
  })
})
