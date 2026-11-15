import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic.js'

describe('writeFileAtomic', () => {
  it('replaces the content, keeps the mode and leaves no temporary file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'odd-atomic-'))
    const file = join(dir, 'index.tsx')
    writeFileSync(file, 'old')
    chmodSync(file, 0o640)
    writeFileAtomic(file, 'new')
    expect(readFileSync(file, 'utf8')).toBe('new')
    expect(statSync(file).mode & 0o777).toBe(0o640)
    expect(readdirSync(dir)).toEqual(['index.tsx'])
  })

  it('creates a new file and cleans up when the folder is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'odd-atomic-'))
    writeFileAtomic(join(dir, 'a.json'), '{}')
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('{}')
    expect(() => writeFileAtomic(join(dir, 'missing', 'b.json'), '{}')).toThrow()
    expect(readdirSync(dir)).toEqual(['a.json'])
  })
})
