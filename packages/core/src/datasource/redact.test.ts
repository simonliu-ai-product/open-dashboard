import type { DatasourceConfig } from '../config.js'
import { MASK, redact, redactValue, registerSecrets, secretsInEnv, secretsOf } from './redact.js'
import { DatasourceError, errorMessage } from './types.js'

afterEach(() => registerSecrets([]))

describe('redact — shapes of credentials, configured or not', () => {
  it('masks the password in URL userinfo and keeps the host', () => {
    expect(redact('connect failed: postgres://reader:hunter2@db.internal:5432/app')).toBe(
      `connect failed: postgres://reader:${MASK}@db.internal:5432/app`,
    )
    expect(redact('https://u:p%40ss@ch.example:8443')).toBe(`https://u:${MASK}@ch.example:8443`)
  })

  it('masks key=value secrets in connection strings and query strings', () => {
    expect(redact('Server=db;User Id=sa;Password=Pa55word!;Encrypt=true')).toBe(
      `Server=db;User Id=sa;Password=${MASK};Encrypt=true`,
    )
    expect(redact('mysql://h/db?ssl=1&password=abc123&x=1')).toBe(
      `mysql://h/db?ssl=1&password=${MASK}&x=1`,
    )
    expect(redact("token: 'abcdef123456'")).toBe(`token: ${MASK}`)
  })

  it('masks JSON secrets, bearer tokens and private keys', () => {
    expect(redact('{"user":"a","password":"x\\"y"}')).toBe(`{"user":"a","password":"${MASK}"}`)
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc')).toBe(
      `Authorization: Bearer ${MASK}`,
    )
    expect(redact('key -----BEGIN PRIVATE KEY-----\nMIIEv\n-----END PRIVATE KEY----- end')).toBe(
      `key ${MASK} end`,
    )
  })

  it('leaves ordinary messages alone', () => {
    const message = 'connect ECONNREFUSED 127.0.0.1:5432 — no such table: orders (token count 3)'
    expect(redact(message)).toBe(message)
  })
})

describe('known secrets — whatever the message looks like', () => {
  it('masks a registered value, also URL-encoded, longest first', () => {
    registerSecrets(['s3cr3t p@ss', 's3cr3t'])
    expect(redact('auth failed for s3cr3t p@ss')).toBe(`auth failed for ${MASK}`)
    expect(redact('dsn=…s3cr3t%20p%40ss…')).toBe(`dsn=…${MASK}…`)
    expect(redact('just s3cr3t')).toBe(`just ${MASK}`)
  })

  it('collects every secret a datasource config holds', () => {
    const config = {
      app: { type: 'postgres', url: 'postgres://u:pg-pass@h/db' },
      erp: { type: 'mssql', url: 'Server=x;User Id=sa;Password=ms-pass;' },
      ora: { type: 'oracle', user: 'u', password: 'ora-pass', connectString: 'h/svc' },
      bq: {
        type: 'bigquery',
        projectId: 'p',
        credentials: { client_email: 'a@b', private_key: 'bq-private-key' },
      },
      snow: { type: 'snowflake', account: 'a', username: 'u', options: { token: 'sf-token' } },
      duck: {
        type: 'duckdb',
        init: ["CREATE SECRET (TYPE s3, KEY_ID 'AKIAEXAMPLE', SECRET 'duck-secret')"],
      },
      file: { type: 'sqlite', file: 'data/shop.db' },
    } as unknown as Record<string, DatasourceConfig>
    expect(secretsOf(config).sort()).toEqual(
      [
        'AKIAEXAMPLE',
        'bq-private-key',
        'duck-secret',
        'ms-pass',
        'ora-pass',
        'pg-pass',
        'sf-token',
      ].sort(),
    )
  })

  it('takes secret-looking environment variables, not every value', () => {
    expect(
      secretsInEnv({
        DATABASE_URL: 'postgres://u:env-pass@h/db',
        API_TOKEN: 'tok_1234567890',
        NO_AUTH: 'true',
        SSH_AUTH_SOCK: '/private/tmp/agent.sock',
        KEY_COUNT: '12345678',
        HOME: '/Users/me',
        PATH: '/usr/bin',
      }).sort(),
    ).toEqual(['env-pass', 'tok_1234567890'])
  })
})

describe('where messages leave', () => {
  it('masks driver errors and our own errors', () => {
    registerSecrets(['hunter2'])
    expect(errorMessage(new Error('login failed: password hunter2 rejected'))).toBe(
      `login failed: password ${MASK} rejected`,
    )
    const aggregate = Object.assign(new Error(''), {
      errors: [new Error('postgres://u:hunter2@h refused')],
    })
    expect(errorMessage(aggregate)).toBe(`postgres://u:${MASK}@h refused`)
    expect(new DatasourceError('bad url postgres://u:other@h').message).toBe(
      `bad url postgres://u:${MASK}@h`,
    )
  })

  it('deep-masks a payload', () => {
    registerSecrets(['hunter2'])
    expect(redactValue({ error: 'x hunter2', list: [{ error: 'hunter2' }], n: 1 })).toEqual({
      error: `x ${MASK}`,
      list: [{ error: MASK }],
      n: 1,
    })
  })
})
