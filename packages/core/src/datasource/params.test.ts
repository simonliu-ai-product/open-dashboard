import { bindParams, compileParams, MissingParamError, referencedParams } from './params.js'

describe('compileParams', () => {
  it('rewrites named placeholders positionally', () => {
    expect(compileParams('SELECT * FROM t WHERE a >= :from AND a < :to', 'question')).toEqual({
      text: 'SELECT * FROM t WHERE a >= ? AND a < ?',
      names: ['from', 'to'],
    })
  })

  it('reuses one $n for a repeated name in dollar style', () => {
    expect(compileParams('(:region IS NULL OR region = :region) AND x = :y', 'dollar')).toEqual({
      text: '($1 IS NULL OR region = $1) AND x = $2',
      names: ['region', 'y'],
    })
  })

  it('emits one ? per occurrence in question style', () => {
    expect(compileParams('(:r IS NULL OR r = :r)', 'question').names).toEqual(['r', 'r'])
  })

  it('leaves colons inside strings, identifiers, comments and casts alone', () => {
    const sql = `SELECT ':nope', "a:b", \`c:d\`, x::date, 'it''s :still' -- :comment
      /* :block */ FROM t WHERE ts > :from`
    const out = compileParams(sql, 'dollar')
    expect(out.names).toEqual(['from'])
    expect(out.text).toContain("':nope'")
    expect(out.text).toContain('x::date')
    expect(out.text).toContain('-- :comment')
    expect(out.text).toContain('/* :block */')
    expect(out.text.endsWith('ts > $1')).toBe(true)
  })

  it('leaves Postgres dollar-quoted bodies alone', () => {
    expect(compileParams('SELECT $$ :x $$, $tag$ :y $tag$, :z', 'dollar').names).toEqual(['z'])
  })

  it('does not treat a time literal as a parameter', () => {
    expect(referencedParams("SELECT '10:30' AS t")).toEqual([])
  })
})

describe('bindParams', () => {
  it('binds in placeholder order, null included', () => {
    expect(bindParams(['a', 'b', 'a'], { a: 1, b: null })).toEqual([1, null, 1])
  })

  it('names every missing parameter once', () => {
    expect(() => bindParams(['a', 'b', 'b'], { a: 1 })).toThrow(MissingParamError)
    expect(() => bindParams(['a', 'b', 'b'], {})).toThrow(/:a, :b/)
  })
})
