import { openBigquery } from './bigquery.js'
import { openSnowflake } from './snowflake.js'

/**
 * BigQuery and Snowflake need a cloud account to reach, so these drive the
 * drivers against stand-ins for the SDKs and check what would be sent.
 */
const peers = new Map<string, unknown>()
vi.mock('./peer.js', () => ({
  importPeer: async (specifier: string) => {
    const found = peers.get(specifier)
    if (!found) throw new Error(`no fake for ${specifier}`)
    return found
  },
}))

const options = { maxRows: 2, timeoutMs: 5000 }

describe('bigquery driver', () => {
  class BigQueryInt {
    constructor(readonly value: string) {}
  }
  class BigQueryDate {
    constructor(readonly value: string) {}
  }
  class Big {
    constructor(private readonly text: string) {}
    toString() {
      return this.text
    }
  }

  let jobs: Record<string, any>[]
  let dry: { statementType: string; totalBytesProcessed: string }

  beforeEach(() => {
    jobs = []
    dry = { statementType: 'SELECT', totalBytesProcessed: '1024' }
    peers.set('@google-cloud/bigquery', {
      BigQuery: class {
        constructor(readonly config: unknown) {}
        async createQueryJob(job: Record<string, any>) {
          jobs.push(job)
          if (job.dryRun) return [{ metadata: { statistics: { query: dry } } }]
          return [
            {
              metadata: {},
              getQueryResults: async (o: Record<string, unknown>) => {
                jobs.push({ results: o })
                return [
                  [
                    {
                      day: new BigQueryDate('2026-01-02'),
                      n: new BigQueryInt('7'),
                      big: new BigQueryInt('9007199254740993'),
                      amount: new Big('12.50'),
                    },
                    {
                      day: new BigQueryDate('2026-01-03'),
                      n: new BigQueryInt('8'),
                      big: new BigQueryInt('1'),
                      amount: new Big('1'),
                    },
                    {
                      day: new BigQueryDate('2026-01-04'),
                      n: new BigQueryInt('9'),
                      big: new BigQueryInt('1'),
                      amount: new Big('1'),
                    },
                  ],
                  null,
                  {
                    schema: {
                      fields: [{ name: 'day' }, { name: 'n' }, { name: 'big' }, { name: 'amount' }],
                    },
                    totalRows: '3',
                  },
                ]
              },
            },
          ]
        }
        async getDatasets() {
          return [[]]
        }
      },
    })
  })

  const open = (extra: Record<string, unknown> = {}) =>
    openBigquery('bq', { type: 'bigquery', projectId: 'p', dataset: 'analytics', ...extra }, '/tmp')

  it('dry-runs, then runs with @params, NULL types, a byte cap and a timeout', async () => {
    const source = await open()
    const result = await source.query(
      'SELECT :a AS a, :n AS n, :a AS again',
      { a: 'x', n: null },
      options,
    )
    expect(jobs[0]).toMatchObject({
      dryRun: true,
      query: 'SELECT @p1 AS a, @p2 AS n, @p1 AS again',
      params: { p1: 'x', p2: null },
      types: { p2: 'STRING' },
      useLegacySql: false,
      defaultDataset: { projectId: 'p', datasetId: 'analytics' },
    })
    expect(jobs[1]).toMatchObject({
      maximumBytesBilled: String(10 * 1024 ** 3),
      jobTimeoutMs: 5000,
    })
    expect(jobs[2]).toMatchObject({ results: { maxResults: 3, wrapIntegers: true } })
    expect(result.rows).toEqual([
      { day: '2026-01-02', n: 7, big: '9007199254740993', amount: 12.5 },
      { day: '2026-01-03', n: 8, big: 1, amount: 1 },
    ])
    expect(result.truncated).toBe(true)
  })

  it('refuses anything the dry run says is not a SELECT, before running it', async () => {
    dry.statementType = 'DELETE'
    const source = await open()
    await expect(source.query('DELETE FROM t WHERE true', {}, options)).rejects.toThrow(
      /only SELECT.*DELETE/,
    )
    expect(jobs.filter((j) => !j.dryRun)).toHaveLength(0)
  })

  it('refuses a scan over the byte cap, naming the size', async () => {
    dry.totalBytesProcessed = String(3 * 1024 ** 3)
    const source = await open({ maximumBytesBilled: 1024 ** 3 })
    await expect(source.query('SELECT * FROM big', {}, options)).rejects.toThrow(
      /3\.00 GiB, over the 1\.00 GiB limit/,
    )
  })
})

describe('snowflake driver', () => {
  let executed: { sqlText: string; binds?: unknown[] }[]

  beforeEach(() => {
    executed = []
    const connection = {
      execute(o: {
        sqlText: string
        binds?: unknown[]
        complete: (e: unknown, s: unknown, r: unknown) => void
      }) {
        executed.push({ sqlText: o.sqlText, binds: o.binds })
        const columns = ['REVENUE', 'Region', 'DAY']
        o.complete(
          undefined,
          { getColumns: () => columns.map((name) => ({ getName: () => name })) },
          o.sqlText.startsWith('ALTER')
            ? []
            : [{ REVENUE: 10, Region: 'North', DAY: '2026-01-02' }],
        )
      },
    }
    peers.set('snowflake-sdk', {
      configure: () => {},
      createPool: () => ({
        use: (task: (c: unknown) => Promise<unknown>) => task(connection),
        drain: async () => {},
        clear: async () => {},
      }),
    })
  })

  const open = () =>
    openSnowflake(
      'sf',
      { type: 'snowflake', account: 'org-acct', username: 'reader', password: 'x' },
      '/tmp',
    )

  it('binds positionally, folds upper-case names, sets the session up once', async () => {
    const source = await open()
    const result = await source.query(
      'SELECT :a AS revenue FROM t WHERE r = :a',
      { a: 'North' },
      options,
    )
    await source.query('SELECT 1', {}, options)
    const select = executed.find((e) => e.sqlText.startsWith('SELECT :') || e.sqlText.includes('?'))
    expect(select).toEqual({
      sqlText: 'SELECT ? AS revenue FROM t WHERE r = ?',
      binds: ['North', 'North'],
    })
    expect(result.rows).toEqual([{ revenue: 10, Region: 'North', day: '2026-01-02' }])
    expect(executed.filter((e) => e.sqlText.includes('DATE_OUTPUT_FORMAT'))).toHaveLength(1)
    expect(
      executed.filter((e) => e.sqlText.includes('STATEMENT_TIMEOUT_IN_SECONDS = 5')),
    ).toHaveLength(2)
  })

  it('refuses writes before anything is sent', async () => {
    const source = await open()
    await expect(source.query('DELETE FROM t', {}, options)).rejects.toThrow(/only SELECT/)
    expect(executed).toHaveLength(0)
  })
})
