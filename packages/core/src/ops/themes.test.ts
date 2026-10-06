import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Fixture, makeFixture } from './fixture.test-helper.js'
import { listThemes, readTheme, themeIdOf, writeTheme } from './themes.js'

let fixture: Fixture
afterEach(() => fixture?.cleanup())

describe('themes', () => {
  it('creates, reads, lists and rewrites a theme', async () => {
    fixture = await makeFixture()
    const config = fixture.workspace.config
    const { hash } = writeTheme(config, 'brand', { name: 'Brand', radius: 4 }, '')
    expect(JSON.parse(readFileSync(join(fixture.root, 'themes/brand.json'), 'utf8'))).toEqual({
      name: 'Brand',
      radius: 4,
    })
    expect(readTheme(config, 'brand')).toMatchObject({ id: 'brand', hash, theme: { radius: 4 } })
    expect(listThemes(config).themes).toEqual([
      { id: 'brand', name: 'Brand', file: 'themes/brand.json' },
    ])
    writeTheme(config, 'brand', { name: 'Brand', radius: 6 }, hash)
    expect(readTheme(config, 'brand').theme.radius).toBe(6)
  })

  it('refuses a stale write, a taken id, a bad id and a bad theme', async () => {
    fixture = await makeFixture({ 'themes/brand.json': '{"name":"Brand"}\n' })
    const config = fixture.workspace.config
    expect(() => writeTheme(config, 'brand', { name: 'X' }, 'stale')).toThrow(/changed on disk/)
    expect(() => writeTheme(config, 'brand', { name: 'X' }, '')).toThrow(/already exists/)
    expect(() => writeTheme(config, '../evil', { name: 'X' }, '')).toThrow(/not a theme id/)
    expect(() => writeTheme(config, 'ok', { light: { accent: 'blue' } }, '')).toThrow(/accent/)
    expect(existsSync(join(fixture.root, 'themes/ok.json'))).toBe(false)
  })

  it('reports the workspace default and lists a broken theme so it can be fixed', async () => {
    fixture = await makeFixture({ 'themes/broken.json': '{ nope' })
    const config = { ...fixture.workspace.config, theme: 'broken' }
    expect(listThemes(config)).toEqual({
      default: 'broken',
      themes: [{ id: 'broken', name: 'broken', file: 'themes/broken.json' }],
    })
    expect(() => readTheme(config, 'broken')).toThrow(/not valid JSON/)
  })

  it('knows which watched files are themes', async () => {
    fixture = await makeFixture()
    const config = fixture.workspace.config
    expect(themeIdOf(config, join(config.root, 'themes/brand.json'))).toBe('brand')
    expect(themeIdOf(config, join(config.root, 'themes/sub/x.json'))).toBeUndefined()
    expect(themeIdOf(config, join(config.root, 'dashboards/a/index.tsx'))).toBeUndefined()
  })
})
