import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openHttp } from './http.js'
import { pickRows, tablesIn } from './json-tables.js'
import { openMcp } from './mcp.js'
import { MASK, registerSecrets } from './redact.js'
import type { Datasource } from './types.js'

const OPTIONS = { maxRows: 100, timeoutMs: 5000 }

function serve(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void) {
  return new Promise<{ server: Server; url: string }>((resolve) => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => handler(req, body, res))
    })
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    )
  })
}

const opened: Datasource[] = []
const servers: Server[] = []
afterEach(async () => {
  registerSecrets([])
  await Promise.all(opened.splice(0).map((s) => s.close()))
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections()
      return new Promise((r) => s.close(r))
    }),
  )
})

describe('json tables', () => {
  it('finds the rows: a path, the body itself, or its first array', () => {
    expect(pickRows({ data: { items: [1] } }, 'data.items', 'x')).toEqual([1])
    expect(pickRows([{ a: 1 }], undefined, 'x')).toEqual([{ a: 1 }])
    expect(pickRows({ meta: 1, rows: [{ a: 1 }] }, undefined, 'x')).toEqual([{ a: 1 }])
    expect(() => pickRows({ data: 3 }, 'data', 'x')).toThrow(/not a list/)
  })

  it('knows which tables a query names, ignoring strings and comments', () => {
    expect(
      tablesIn('SELECT * FROM orders o JOIN "items" i -- refunds\nWHERE o.note = \'refunds\'', [
        'orders',
        'items',
        'refunds',
      ]),
    ).toEqual(['orders', 'items'])
  })
})

describe('http source', () => {
  it('GETs only the tables a query names, once each, and runs SQL over them', async () => {
    const hits: string[] = []
    const { server, url } = await serve((req, _body, res) => {
      hits.push(`${req.method} ${req.url}`)
      res.setHeader('Content-Type', 'application/json')
      if (req.url?.startsWith('/prices')) {
        res.end(
          JSON.stringify({ data: [{ code: '0050', close: '10.5', meta: { board: 'main' } }] }),
        )
      } else res.end(JSON.stringify([{ code: '0050', name: 'ETF' }]))
    })
    servers.push(server)
    const source = await openHttp('twse', {
      type: 'http',
      baseUrl: url,
      tables: {
        prices: { url: '/prices?date=:date', rows: 'data' },
        names: { url: '/names' },
        unused: { url: '/unused' },
      },
    })
    opened.push(source)
    const sql = `SELECT n.name, CAST(p.close AS REAL) AS close, json_extract(p.meta, '$.board') AS board
      FROM prices p JOIN names n USING (code)`
    const params = { date: '2026/10 01' }
    const result = await source.query(sql, params, OPTIONS)
    await source.query(sql, params, OPTIONS)
    expect(result.rows).toEqual([{ name: 'ETF', close: 10.5, board: 'main' }])
    expect(hits.sort()).toEqual(['GET /names', 'GET /prices?date=2026%2F10%2001'])
  })

  it('reports an HTTP error with the status, and masks a token it echoes', async () => {
    registerSecrets(['Bearer sk-live-123456'])
    const { server, url } = await serve((req, _body, res) => {
      res.statusCode = 401
      res.end(`bad credentials: ${req.headers.authorization}`)
    })
    servers.push(server)
    const source = await openHttp('api', {
      type: 'http',
      headers: { Authorization: 'Bearer sk-live-123456' },
      tables: { t: { url: `${url}/t` } },
    })
    opened.push(source)
    const error = await source.query('SELECT * FROM t', {}, OPTIONS).catch((e: Error) => e)
    expect((error as Error).message).toContain('HTTP 401')
    expect((error as Error).message).toContain(MASK)
    expect((error as Error).message).not.toContain('sk-live-123456')
  })

  it('refuses a query that writes, and one that names no table', async () => {
    const { server, url } = await serve((_req, _body, res) => res.end('[{"a":1}]'))
    servers.push(server)
    const source = await openHttp('api', { type: 'http', tables: { t: { url: `${url}/t` } } })
    opened.push(source)
    await expect(source.query('DELETE FROM t', {}, OPTIONS)).rejects.toThrow(/only SELECT/)
    await expect(source.query('SELECT 1', {}, OPTIONS)).rejects.toThrow(/names none of its tables/)
  })
})

const TOOLS = [
  { name: 'list_items', annotations: { readOnlyHint: true } },
  { name: 'delete_items', annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'mystery' },
  { name: 'broken', annotations: { readOnlyHint: true } },
]

/** The server side of MCP for one message; null for a notification. */
function answer(message: { id?: number; method: string; params?: { name?: string } }): unknown {
  if (message.id === undefined) return null
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result })
  if (message.method === 'initialize')
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: {},
      serverInfo: { name: 'fake', version: '1' },
    })
  if (message.method === 'tools/list') return reply({ tools: TOOLS })
  if (message.method === 'tools/call') {
    if (message.params?.name === 'broken')
      return reply({ isError: true, content: [{ type: 'text', text: 'upstream down' }] })
    return reply({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            source: 'fake',
            data: [
              { id: 1, tags: ['a', 'b'] },
              { id: 2, tags: [] },
            ],
          }),
        },
      ],
    })
  }
  return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no such method' } }
}

describe('mcp source over HTTP', () => {
  async function fakeServer() {
    const calls: string[] = []
    const { server, url } = await serve((req, body, res) => {
      if (req.method === 'DELETE') {
        calls.push('end session')
        return res.end()
      }
      const message = JSON.parse(body)
      calls.push(message.method === 'tools/call' ? `call ${message.params.name}` : message.method)
      expect(req.headers.authorization).toBe('Bearer t0ken-abcdef')
      res.setHeader('Mcp-Session-Id', 'session-1')
      const reply = answer(message)
      if (!reply) {
        res.statusCode = 202
        return res.end()
      }
      // Answer as a short SSE stream, as streamable-HTTP servers may.
      res.setHeader('Content-Type', 'text/event-stream')
      res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`)
    })
    servers.push(server)
    return { url, calls }
  }

  it('calls a read-only tool and runs SQL over its JSON', async () => {
    const { url, calls } = await fakeServer()
    const source = await openMcp('hub', {
      type: 'mcp',
      url,
      headers: { Authorization: 'Bearer t0ken-abcdef' },
      tables: { items: { tool: 'list_items', rows: 'data' } },
    })
    opened.push(source)
    const result = await source.query(
      'SELECT id, json_array_length(tags) AS tags FROM items ORDER BY id',
      {},
      OPTIONS,
    )
    expect(result.rows).toEqual([
      { id: 1, tags: 2 },
      { id: 2, tags: 0 },
    ])
    expect(calls).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/list',
      'call list_items',
    ])
  })

  it('never calls a destructive tool, nor an unannotated one unless allowed', async () => {
    const { url, calls } = await fakeServer()
    const source = await openMcp('hub', {
      type: 'mcp',
      url,
      headers: { Authorization: 'Bearer t0ken-abcdef' },
      tables: {
        gone: { tool: 'delete_items' },
        maybe: { tool: 'mystery', rows: 'data' },
        broken: { tool: 'broken' },
      },
    })
    opened.push(source)
    await expect(source.query('SELECT * FROM gone', {}, OPTIONS)).rejects.toThrow(/destructive/)
    await expect(source.query('SELECT * FROM maybe', {}, OPTIONS)).rejects.toThrow(
      /does not say it is read-only/,
    )
    await expect(source.query('SELECT * FROM broken', {}, OPTIONS)).rejects.toThrow(/upstream down/)
    expect(calls).not.toContain('call delete_items')
    expect(calls).not.toContain('call mystery')

    const trusting = await openMcp('hub2', {
      type: 'mcp',
      url,
      headers: { Authorization: 'Bearer t0ken-abcdef' },
      allowUnannotated: true,
      tables: { maybe: { tool: 'mystery', rows: 'data' }, gone: { tool: 'delete_items' } },
    })
    opened.push(trusting)
    expect((await trusting.query('SELECT COUNT(*) AS n FROM maybe', {}, OPTIONS)).rows).toEqual([
      { n: 2 },
    ])
    await expect(trusting.query('SELECT * FROM gone', {}, OPTIONS)).rejects.toThrow(/destructive/)
  })
})

describe('mcp source over stdio', () => {
  it('talks to a local server process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'odd-mcp-'))
    const script = join(dir, 'server.mjs')
    writeFileSync(
      script,
      `const TOOLS = ${JSON.stringify(TOOLS)}
${answer.toString()}
let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let i
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
    if (!line.trim()) continue
    console.log('log line the client must skip')
    const reply = answer(JSON.parse(line))
    if (reply) process.stdout.write(JSON.stringify(reply) + '\\n')
  }
})
`,
    )
    try {
      const source = await openMcp('local', {
        type: 'mcp',
        command: process.execPath,
        args: [script],
        tables: { items: { tool: 'list_items', rows: 'data' } },
      })
      opened.push(source)
      const result = await source.query('SELECT COUNT(*) AS n FROM items', {}, OPTIONS)
      expect(result.rows).toEqual([{ n: 2 }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
