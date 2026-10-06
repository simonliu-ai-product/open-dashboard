import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBySource } from '../vite/file-guard.js'
import type { ResolvedConfig } from '../workspace.js'
import { openFiles, parseCsv, tableFiles } from './files.js'
import type { Datasource } from './types.js'

const OPTIONS = { maxRows: 1000, timeoutMs: 5000 }

let root: string
let opened: Datasource[] = []
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'odd-files-')))
})
afterEach(async () => {
  for (const source of opened) await source.close()
  opened = []
  rmSync(root, { recursive: true, force: true })
})

async function open(config: Parameters<typeof openFiles>[1]) {
  const source = await openFiles('files', config, root)
  opened.push(source)
  return source
}

describe('CSV', () => {
  it('parses quotes, doubled quotes, line breaks in fields and a BOM', () => {
    expect(parseCsv('﻿a,b\n"x, y","say ""hi""\nthere"\r\n1,2\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nthere'],
      ['1', '2'],
    ])
  })

  it('makes a column numeric only when every value is a plain number', async () => {
    write('data/stocks.csv', 'code,price,volume,note\n0050,116.5,1200,\n2330,2585,"1,234",ok\n')
    const source = await open({ type: 'csv', tables: { stocks: { file: 'data/stocks.csv' } } })
    const { rows } = await source.query('SELECT * FROM stocks ORDER BY code', {}, OPTIONS)
    expect(rows).toEqual([
      { code: '0050', price: 116.5, volume: '1200', note: null },
      { code: '2330', price: 2585, volume: '1,234', note: 'ok' },
    ])
  })

  it('reads TSV by its extension', async () => {
    write('a.tsv', 'x\ty\n1\t2\n')
    const source = await open({ type: 'csv', tables: { a: { file: 'a.tsv' } } })
    expect((await source.query('SELECT x + y AS s FROM a', {}, OPTIONS)).rows).toEqual([{ s: 3 }])
  })
})

describe('JSON', () => {
  it('reads rows at a path, nested values as JSON text', async () => {
    write('data/r.json', JSON.stringify({ data: { items: [{ id: 1, tags: ['a'] }] } }))
    const source = await open({
      type: 'json',
      tables: { r: { file: 'data/r.json', rows: 'data.items' } },
    })
    const { rows } = await source.query(
      "SELECT id, json_extract(tags, '$[0]') AS tag FROM r",
      {},
      OPTIONS,
    )
    expect(rows).toEqual([{ id: 1, tag: 'a' }])
  })

  it('stacks every file a glob matches, with its path in _file', async () => {
    write('results/a/results_1.json', JSON.stringify({ model: 'a', score: 0.5 }))
    write('results/b/deep/results_2.json', JSON.stringify({ model: 'b', score: 0.7 }))
    write('results/b/notes.json', JSON.stringify({ model: 'ignored' }))
    const source = await open({
      type: 'json',
      tables: { r: { file: 'results/**/results_*.json' } },
    })
    const { rows } = await source.query(
      'SELECT _file, model, score FROM r ORDER BY model',
      {},
      OPTIONS,
    )
    expect(rows).toEqual([
      { _file: 'results/a/results_1.json', model: 'a', score: 0.5 },
      { _file: 'results/b/deep/results_2.json', model: 'b', score: 0.7 },
    ])
  })

  it('reads JSON Lines one record per line', async () => {
    write('log.jsonl', '{"ok":true}\n\n{"ok":false}\n')
    const source = await open({ type: 'json', tables: { log: { file: 'log.jsonl' } } })
    expect((await source.query('SELECT COUNT(*) AS n FROM log', {}, OPTIONS)).rows).toEqual([
      { n: 2 },
    ])
  })

  it('reads a file again once it changes', async () => {
    write('n.json', '[{"n":1}]')
    const source = await open({ type: 'json', tables: { n: { file: 'n.json', cache: '1h' } } })
    expect((await source.query('SELECT n FROM n', {}, OPTIONS)).rows).toEqual([{ n: 1 }])
    write('n.json', '[{"n":22}]')
    utimesSync(join(root, 'n.json'), new Date(), new Date(Date.now() + 5000))
    expect((await source.query('SELECT n FROM n', {}, OPTIONS)).rows).toEqual([{ n: 22 }])
  })
})

describe('file safety', () => {
  it('refuses a pattern outside the workspace', () => {
    expect(() => tableFiles(root, '../secret.json')).toThrow(/outside the workspace/)
    expect(() => tableFiles(root, '/etc/passwd')).toThrow(/outside the workspace/)
  })

  it('names a missing file in the error', async () => {
    const source = await open({ type: 'csv', tables: { a: { file: 'nope/*.csv' } } })
    await expect(source.query('SELECT * FROM a', {}, OPTIONS)).rejects.toThrow(/no file matches/)
  })

  it('keeps the files a source reads off the dev server, including ones added later', () => {
    const config = {
      root,
      datasources: { r: { type: 'json', tables: { r: { file: 'results/**/*.json' } } } },
    } as unknown as ResolvedConfig
    expect(readBySource(config, join(root, 'results/new/later.json'))).toBe(true)
    expect(readBySource(config, join(root, 'dashboards/x/map.json'))).toBe(false)
  })
})
