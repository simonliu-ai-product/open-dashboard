import type { ResolvedCollector, ResolvedConfig } from '../workspace.js'
import { freshnessOf, sourceFreshness } from './freshness.js'

const collector = (source: string): ResolvedCollector => ({
  id: source,
  run: 'true',
  everyMs: undefined,
  every: undefined,
  source,
  timeoutMs: 1000,
  allowEmpty: false,
})

const config = {
  datasources: {
    warehouse: { type: 'postgres', url: 'postgres://x' },
    api: { type: 'http', tables: {} },
    stats: { type: 'json', tables: {} },
    seed: { type: 'csv', tables: {} },
    shop: { type: 'sqlite', file: 'shop.db' },
    etl: { type: 'sqlite', file: 'etl.db', freshness: 'live' },
    scratch: { type: 'duckdb' },
  },
  collectors: { stats: collector('stats') },
} as unknown as ResolvedConfig

describe('freshness', () => {
  it('works it out from the type and the collectors', () => {
    expect(sourceFreshness(config, 'warehouse')).toBe('live')
    expect(sourceFreshness(config, 'api')).toBe('live')
    expect(sourceFreshness(config, 'stats')).toBe('collected')
    expect(sourceFreshness(config, 'seed')).toBe('static')
    expect(sourceFreshness(config, 'shop')).toBe('static')
    expect(sourceFreshness(config, 'scratch')).toBe('live')
  })

  it('takes what a source says over what it works out', () => {
    expect(sourceFreshness(config, 'etl')).toBe('live')
  })

  it('groups a dashboard’s sources', () => {
    expect(freshnessOf(config, ['stats', 'api', 'seed', 'api'])).toEqual({
      live: ['api'],
      collected: ['stats'],
      static: ['seed'],
    })
  })
})
