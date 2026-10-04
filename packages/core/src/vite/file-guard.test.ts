import picomatch from 'picomatch'
import type { ResolvedConfig } from '../workspace.js'
import { referencedFiles, requestedFile } from './file-guard.js'
import { DENY } from './index.js'

const root = '/work/space'
const config = {
  root,
  datasources: {
    shop: { type: 'sqlite', file: 'data/shop.db' },
    lake: { type: 'duckdb', file: ':memory:' },
    bq: { type: 'bigquery', projectId: 'p', keyFilename: 'keys/sa.json' },
    snow: { type: 'snowflake', account: 'a', username: 'u', privateKeyPath: 'secrets/rsa_key.p8' },
  },
} as unknown as ResolvedConfig

describe('files a datasource names are never served', () => {
  it('collects the database and key files, not :memory:', () => {
    expect([...referencedFiles(config)].sort()).toEqual([
      '/work/space/data/shop.db',
      '/work/space/keys/sa.json',
      '/work/space/secrets/rsa_key.p8',
    ])
  })

  it('maps root paths, /@fs paths and queries to the file they would read', () => {
    expect(requestedFile('/keys/sa.json?import&raw', root, '/__odd/api/')).toBe(
      '/work/space/keys/sa.json',
    )
    expect(requestedFile('/@fs/work/space/data/shop.db', root, '/__odd/api/')).toBe(
      '/work/space/data/shop.db',
    )
    expect(requestedFile('/data/sh%6Fp.db', root, '/__odd/api/')).toBe('/work/space/data/shop.db')
    expect(requestedFile('/__odd/api/query?id=x', root, '/__odd/api/')).toBeUndefined()
  })
})

describe('the deny list', () => {
  // Built the way Vite builds it, and applied to the absolute path asked for.
  const match = picomatch(
    DENY.map((pattern) => (pattern.includes('/') ? pattern : `**/${pattern}`)),
    { matchBase: false, nocase: true, dot: true },
  )
  const denied = (path: string) => match(`/work/space/${path}`)
  it('refuses data, keys, SQL, config and notes', () => {
    for (const path of [
      '.env',
      '.env.local',
      'data/shop.db',
      'data/x.sqlite3',
      'lake/orders.parquet',
      'exports/report.csv',
      'dashboards/sales/queries.sql',
      'open-dashboard.config.ts',
      'databases/shop/database.md',
      'node_modules/.open-dashboard/current.json',
      'keys/rsa_key.p8',
      'certs/server.pem',
    ]) {
      expect(denied(path), path).toBe(true)
    }
  })

  it('still serves what the viewer needs', () => {
    for (const path of [
      'dashboards/sales/index.tsx',
      'dashboards/gallery/taiwan-counties.json',
      'package.json',
      'README.md',
    ]) {
      expect(denied(path), path).toBe(false)
    }
  })
})
