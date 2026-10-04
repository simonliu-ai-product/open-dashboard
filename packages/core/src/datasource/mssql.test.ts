import { createRequire } from 'node:module'
import { mssqlConfig, openMssql } from './mssql.js'
import { MASK, registerSecrets } from './redact.js'

const sql = createRequire(import.meta.url)('mssql') as {
  ConnectionPool: { parseConnectionString(text: string): Record<string, unknown> }
}

afterEach(() => registerSecrets([]))

describe('SQL Server connection strings', () => {
  it('reads an ADO.NET string through mssql itself', () => {
    expect(
      mssqlConfig('Server=db.local,1433;Database=erp;User Id=sa;Password=p;', (text) =>
        sql.ConnectionPool.parseConnectionString(text),
      ),
    ).toMatchObject({ server: 'db.local', port: 1433, database: 'erp', user: 'sa', password: 'p' })
  })

  it('reads an mssql:// URL', () => {
    expect(mssqlConfig('mssql://sa:p@db.local:1433/erp?encrypt=true', () => ({}))).toMatchObject({
      server: 'db.local',
      port: 1433,
      database: 'erp',
      user: 'sa',
      password: 'p',
      options: { encrypt: true },
    })
  })

  it('opens with an ADO.NET string and fails on the network, not on parsing — masked', async () => {
    registerSecrets(['Erp-S3cret!'])
    const source = await openMssql(
      'erp',
      {
        type: 'mssql',
        url: 'Server=127.0.0.1,59998;Database=erp;User Id=sa;Password=Erp-S3cret!;Encrypt=false;Connection Timeout=2',
      },
      process.cwd(),
    ).catch((error: Error) => error)
    const error =
      source instanceof Error
        ? source
        : await source.query('SELECT 1', {}, { maxRows: 1, timeoutMs: 2000 }).catch((e: Error) => e)
    const message = String((error as Error).message)
    expect(message).not.toMatch(/_parseConnectionString/)
    expect(message).not.toContain('Erp-S3cret!')
    if (message.includes('Password')) expect(message).toContain(MASK)
  })
})
