import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DatasourceConfig, QueryResult } from '../config.js'
import { type Datasource, openDatasource } from './index.js'

/**
 * One contract, every driver. Each engine is reached only when its connection
 * is given in the environment (SQLite and DuckDB always run):
 *
 *   ODD_TEST_POSTGRES_URL  ODD_TEST_MYSQL_URL  ODD_TEST_MSSQL_URL
 *   ODD_TEST_ORACLE_URL    ODD_TEST_CLICKHOUSE_URL
 *
 * The statements differ per dialect; what comes back must not.
 */
interface Dialect {
  type: DatasourceConfig['type']
  config: (root: string) => DatasourceConfig | undefined
  params: string
  types: string
  series: string
  write: string
  expected: Record<string, unknown>
  /** Column names whose type the engine cannot express. */
  skip?: string[]
}

const WALL = '2026-01-02 03:04:05'
const EXPECTED = { i: 1, big: '9007199254740993', d: 12.5, day: '2026-01-02', ts: WALL, s: 'x' }

const hasPackage = (name: string) => {
  try {
    createRequire(import.meta.url).resolve(name)
    return true
  } catch {
    return false
  }
}

const DIALECTS: Dialect[] = [
  {
    type: 'sqlite',
    config: (root) => {
      const file = join(root, 'c.db')
      new DatabaseSync(file).close()
      return { type: 'sqlite', file }
    },
    params: 'SELECT :a AS a, :n AS n, :a AS again, :k AS k',
    types: `SELECT 1 AS i, '9007199254740993' AS big, 12.5 AS d, '2026-01-02' AS day, '${WALL}' AS ts, 'x' AS s`,
    series:
      'WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM n WHERE v < 10) SELECT v FROM n',
    write: 'CREATE TABLE odd_probe (x INTEGER)',
    expected: EXPECTED,
  },
  {
    type: 'duckdb',
    config: () => (hasPackage('@duckdb/node-api') ? { type: 'duckdb' } : undefined),
    params: 'SELECT :a AS a, :n AS n, :a AS again, :k AS k',
    types: `SELECT 1 AS i, 9007199254740993::BIGINT AS big, 12.50::DECIMAL(10,2) AS d, DATE '2026-01-02' AS day, TIMESTAMP '${WALL}' AS ts, 'x' AS s`,
    series: 'SELECT range AS v FROM range(10)',
    write: "COPY (SELECT 1) TO 'odd_probe.csv'",
    expected: EXPECTED,
  },
  {
    type: 'postgres',
    config: () =>
      process.env.ODD_TEST_POSTGRES_URL
        ? { type: 'postgres', url: process.env.ODD_TEST_POSTGRES_URL }
        : undefined,
    params: 'SELECT :a::text AS a, :n::text AS n, :a::text AS again, :k::int AS k',
    types: `SELECT 1 AS i, 9007199254740993::bigint AS big, 12.50::numeric(10,2) AS d, DATE '2026-01-02' AS day, TIMESTAMP '${WALL}' AS ts, 'x' AS s`,
    series: 'SELECT generate_series(1, 10) AS v',
    write: 'CREATE TABLE odd_probe (x int)',
    expected: EXPECTED,
  },
  {
    type: 'mysql',
    config: () =>
      process.env.ODD_TEST_MYSQL_URL
        ? { type: 'mysql', url: process.env.ODD_TEST_MYSQL_URL }
        : undefined,
    params: 'SELECT :a AS a, :n AS n, :a AS again, :k AS k',
    types: `SELECT 1 AS i, CAST(9007199254740993 AS SIGNED) AS big, CAST(12.5 AS DECIMAL(10,2)) AS d, DATE '2026-01-02' AS day, TIMESTAMP '${WALL}' AS ts, 'x' AS s`,
    series:
      'WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM n WHERE v < 10) SELECT v FROM n',
    write: 'CREATE TABLE odd_probe (x int)',
    expected: EXPECTED,
  },
  {
    type: 'mssql',
    config: () =>
      process.env.ODD_TEST_MSSQL_URL
        ? { type: 'mssql', url: process.env.ODD_TEST_MSSQL_URL }
        : undefined,
    params: 'SELECT :a AS a, :n AS n, :a AS again, :k AS k',
    types: `SELECT 1 AS i, CAST(9007199254740993 AS BIGINT) AS big, CAST(12.5 AS DECIMAL(10,2)) AS d, CAST('2026-01-02' AS DATE) AS day, CAST('${WALL}' AS DATETIME2(0)) AS ts, 'x' AS s`,
    series: 'SELECT TOP (10) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS v FROM sys.all_objects',
    write: 'CREATE TABLE odd_probe (x int)',
    expected: EXPECTED,
  },
  {
    type: 'oracle',
    config: () =>
      process.env.ODD_TEST_ORACLE_URL
        ? { type: 'oracle', url: process.env.ODD_TEST_ORACLE_URL }
        : undefined,
    params: 'SELECT :a AS a, :n AS n, :a AS again, :k AS k FROM dual',
    types: `SELECT 1 AS i, TO_CHAR(9007199254740993) AS big, CAST(12.5 AS NUMBER(10,2)) AS d, DATE '2026-01-02' AS day, TIMESTAMP '${WALL}' AS ts, 'x' AS s FROM dual`,
    series: 'SELECT level AS v FROM dual CONNECT BY level <= 10',
    write: 'CREATE TABLE odd_probe (x NUMBER)',
    expected: EXPECTED,
  },
  {
    type: 'clickhouse',
    config: () =>
      process.env.ODD_TEST_CLICKHOUSE_URL
        ? { type: 'clickhouse', url: process.env.ODD_TEST_CLICKHOUSE_URL }
        : undefined,
    params: 'SELECT :a AS a, :n AS n, :a AS again, :k AS k',
    types: `SELECT toUInt8(1) AS i, toInt64(9007199254740993) AS big, toDecimal64(12.5, 2) AS d, toDate('2026-01-02') AS day, toDateTime('${WALL}') AS ts, 'x' AS s`,
    series: 'SELECT number AS v FROM numbers(10)',
    write: 'CREATE TABLE odd_probe (x UInt8) ENGINE = Memory',
    expected: EXPECTED,
  },
]

const options = { maxRows: 5000, timeoutMs: 15_000 }

for (const dialect of DIALECTS) {
  const root = mkdtempSync(join(tmpdir(), `odd-${dialect.type}-`))
  const config = dialect.config(root)
  describe.skipIf(!config)(`${dialect.type} driver`, () => {
    let source: Datasource
    beforeAll(async () => {
      source = await openDatasource(`test-${dialect.type}`, config as DatasourceConfig, root)
    })
    afterAll(async () => {
      await source?.close()
      rmSync(root, { recursive: true, force: true })
    })

    it('binds named params, including NULL and repeats', async () => {
      const result = await source.query(dialect.params, { a: 'x', n: null, k: 7 }, options)
      expect(result.rows).toEqual([{ a: 'x', n: null, again: 'x', k: 7 }])
    })

    it('returns one shape for every engine: numbers, big integers, decimals, dates, wall-clock times', async () => {
      const result: QueryResult = await source.query(dialect.types, {}, options)
      const row = result.rows[0] ?? {}
      for (const [key, value] of Object.entries(dialect.expected)) {
        if (dialect.skip?.includes(key)) continue
        expect([key, row[key]]).toEqual([key, value])
      }
      const types = Object.fromEntries(result.columns.map((c) => [c.name, c.type]))
      expect(types).toMatchObject({
        i: 'number',
        d: 'number',
        day: 'date',
        ts: 'date',
        s: 'string',
      })
    })

    it('caps rows and marks the result truncated', async () => {
      const result = await source.query(dialect.series, {}, { ...options, maxRows: 3 })
      expect(result.rows).toHaveLength(3)
      expect(result.truncated).toBe(true)
    })

    it('refuses to write', async () => {
      await expect(source.query(dialect.write, {}, options)).rejects.toThrow()
    })

    it('describes its schema', async () => {
      const schema = await source.schema()
      expect(schema.type).toBe(dialect.type)
      expect(Array.isArray(schema.tables)).toBe(true)
    })
  })
}
