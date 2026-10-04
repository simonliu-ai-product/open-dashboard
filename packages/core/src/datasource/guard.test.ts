import { assertReadOnlySql, foldUpperCase, sqlWords } from './guard.js'
import { compileParams } from './params.js'

describe('assertReadOnlySql', () => {
  it('accepts reads', () => {
    for (const sql of [
      'SELECT 1',
      'select * from t;',
      'WITH x AS (SELECT 1) SELECT * FROM x',
      "SELECT 'drop table x' AS note -- delete everything\n FROM t",
      'SELECT [update] FROM t',
      'SELECT "delete" FROM t',
      'SELECT created_at, updated_by FROM t',
      "SELECT REPLACE(name, 'a', 'b'), TRUNCATE(price, 2), LEFT(x, 1) FROM t",
    ]) {
      expect(() => assertReadOnlySql(sql, 'test')).not.toThrow()
    }
  })

  it('accepts a SELECT that opens with a scalar subquery', () => {
    expect(() =>
      assertReadOnlySql('SELECT (SELECT max(x) FROM t) AS top, 1', 'sqlite'),
    ).not.toThrow()
    expect(() => assertReadOnlySql('WITH(x) AS (SELECT 1) SELECT * FROM x', 'sqlite')).not.toThrow()
    expect(() => assertReadOnlySql('INSERT(1)', 'sqlite')).toThrow(/only SELECT/)
  })

  it('refuses writes, scripts and procedures', () => {
    expect(() => assertReadOnlySql('DELETE FROM t', 'test')).toThrow(/only SELECT/)
    expect(() => assertReadOnlySql('WITH x AS (SELECT 1) DELETE FROM t', 'test')).toThrow(
      /"DELETE"/,
    )
    expect(() => assertReadOnlySql('SELECT 1; DROP TABLE t', 'test')).toThrow(/one statement/)
    expect(() => assertReadOnlySql('SELECT * INTO copy FROM t', 'test')).toThrow(/"INTO"/)
    expect(() => assertReadOnlySql('EXEC sp_who', 'test')).toThrow()
  })

  it('skips strings, identifiers and comments when reading words', () => {
    expect(sqlWords("SELECT 'a;b', [c d] /* drop */ FROM t")).toEqual(['select', 'from', 't'])
    expect(sqlWords('SELECT count(*) FROM t')).toEqual(['select', 'count(', 'from', 't'])
  })
})

describe('foldUpperCase', () => {
  it('folds only all-caps names', () => {
    expect(foldUpperCase('REVENUE')).toBe('revenue')
    expect(foldUpperCase('ORDER_ID')).toBe('order_id')
    expect(foldUpperCase('newCustomers')).toBe('newCustomers')
    expect(foldUpperCase('day')).toBe('day')
    expect(foldUpperCase('2024')).toBe('2024')
  })
})

describe('compileParams with a renderer', () => {
  it('renders one placeholder per distinct name', () => {
    expect(compileParams('a = :x OR b = :x OR c = :y', (name, n) => `@${name}${n}`)).toEqual({
      text: 'a = @x1 OR b = @x1 OR c = @y2',
      names: ['x', 'y'],
    })
  })
})
