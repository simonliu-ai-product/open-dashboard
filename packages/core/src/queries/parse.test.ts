import { parseQueryFile } from './parse.js'

describe('parseQueryFile', () => {
  it('splits on -- name: headers and reads the metadata directly under them', () => {
    const queries = parseQueryFile(
      `-- leading comment is fine

-- name: totals
-- source: warehouse
-- description: Headline numbers
SELECT 1;

-- name: by_month
SELECT 2
-- source: this is just a comment now
`,
      'q.sql',
    )
    expect(queries.map((q) => [q.name, q.source, q.description, q.line])).toEqual([
      ['totals', 'warehouse', 'Headline numbers', 3],
      ['by_month', undefined, undefined, 8],
    ])
    expect(queries[0]?.sql).toBe('SELECT 1')
    expect(queries[1]?.sql).toBe('SELECT 2\n-- source: this is just a comment now')
  })

  it('refuses SQL before the first name', () => {
    expect(() => parseQueryFile('SELECT 1;\n-- name: x\nSELECT 2', 'q.sql')).toThrow(
      /before the first/,
    )
  })

  it('refuses an empty query and a bad name', () => {
    expect(() => parseQueryFile('-- name: x\n\n-- name: y\nSELECT 1', 'q.sql')).toThrow(
      /"x" has no SQL/,
    )
    expect(() => parseQueryFile('-- name: 1bad\nSELECT 1', 'q.sql')).toThrow(
      /not a valid query name/,
    )
  })
})
