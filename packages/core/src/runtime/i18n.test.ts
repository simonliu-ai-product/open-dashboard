import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserLocale, DICTIONARIES, translate } from './i18n.js'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

const translated = Object.entries(DICTIONARIES).filter(([locale]) => locale !== 'en')
const reference = Object.keys(DICTIONARIES['zh-TW']).sort()

describe.each(translated)('%s dictionary', (_locale, dictionary) => {
  it('translates exactly the strings the others do', () => {
    expect(Object.keys(dictionary).sort()).toEqual(reference)
  })

  it('keeps every placeholder of the English key, and no others', () => {
    const broken = Object.entries(dictionary).filter(
      ([en, text]) => placeholders(en).join() !== placeholders(text).join(),
    )
    expect(broken).toEqual([])
  })

  it('has no empty translations', () => {
    expect(Object.entries(dictionary).filter(([, text]) => text.trim() === '')).toEqual([])
  })
})

/** Every literal handed to `t(...)` in the chrome, ternary branches included. */
function sourceKeys(): Set<string> {
  const src = fileURLToPath(new URL('..', import.meta.url))
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        if (!entry.startsWith('i18n-')) walk(path)
      } else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
        files.push(path)
      }
    }
  }
  for (const dir of ['app', 'components']) walk(join(src, dir))
  const keys = new Set<string>()
  for (const file of files) {
    const code = readFileSync(file, 'utf8')
    for (const match of code.matchAll(/\bt\(/g)) {
      let depth = 1
      let i = (match.index ?? 0) + 2
      const start = i
      while (i < code.length && depth > 0) {
        if (code[i] === '(') depth += 1
        else if (code[i] === ')') depth -= 1
        i += 1
      }
      const call = code.slice(start, i - 1)
      const firstArg = call.split(/,\s*\{\s*\n|,\s*\{\s*\w+[:,}]/)[0] ?? ''
      for (const literal of firstArg.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
        const key = literal[1] as string
        if (!['data', 'sql', 'view'].includes(key)) keys.add(key)
      }
    }
  }
  return keys
}

it('has a translation for every string the chrome passes to t()', () => {
  const keys = sourceKeys()
  expect(keys.size).toBeGreaterThan(60)
  const missing = [...keys].filter((key) => !(key in DICTIONARIES['zh-TW']))
  expect(missing).toEqual([])
})

it('falls back to English and fills placeholders', () => {
  expect(translate('ja', 'Not a real key {n}', { n: 3 })).toBe('Not a real key 3')
  expect(translate('zh-TW', '{n} tables', { n: 5 })).toBe('5 張資料表')
})

it('maps browser languages the way open-doc does', () => {
  expect(browserLocale('zh-HK')).toBe('zh-TW')
  expect(browserLocale('zh-Hant-TW')).toBe('zh-TW')
  expect(browserLocale('zh-CN')).toBe('zh-CN')
  expect(browserLocale('ja-JP')).toBe('ja')
  expect(browserLocale('ko-KR')).toBe('ko')
  expect(browserLocale('fr-FR')).toBe('en')
})
