import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpSource } from '../config.js'
import { packageRoot } from '../vite/package-root.js'
import { bindTableValue, jsonSource } from './json-tables.js'
import { type Datasource, DatasourceError } from './types.js'

const PROTOCOL = '2025-06-18'

/** This package's version, as the MCP client reports itself. */
function clientVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as {
      version?: string
    }
    return pkg.version ?? '0'
  } catch {
    return '0'
  }
}
const TIMEOUT_MS = 60_000

interface Tool {
  name: string
  title?: string
  description?: string
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean }
}

interface RpcResponse {
  id?: number
  result?: unknown
  error?: { code: number; message: string }
}

/** JSON-RPC over one of MCP's two transports. Requests only; notifications are fire-and-forget. */
interface Transport {
  request(method: string, params: unknown): Promise<unknown>
  notify(method: string, params?: unknown): Promise<void>
  close(): Promise<void>
}

/** Streamable HTTP: POST each message; the answer is JSON or a short SSE stream. */
function httpTransport(name: string, url: string, headers: Record<string, string>): Transport {
  let session: string | undefined
  let nextId = 1
  const post = async (body: unknown): Promise<Response> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL,
        ...(session ? { 'Mcp-Session-Id': session } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: Error) => {
      throw new DatasourceError(
        `datasource "${name}": ${error.name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000}s` : error.message}`,
      )
    })
    session = response.headers.get('Mcp-Session-Id') ?? session
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new DatasourceError(
        `datasource "${name}": HTTP ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      )
    }
    return response
  }
  return {
    async request(method, params) {
      const id = nextId++
      const response = await post({ jsonrpc: '2.0', id, method, params })
      const text = await response.text()
      const messages = (response.headers.get('Content-Type') ?? '').includes('text/event-stream')
        ? text
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => JSON.parse(line.slice(5)) as RpcResponse)
        : [JSON.parse(text) as RpcResponse]
      const answer = messages.find((m) => m.id === id)
      if (!answer) throw new DatasourceError(`datasource "${name}": no answer to ${method}`)
      if (answer.error) throw new DatasourceError(`datasource "${name}": ${answer.error.message}`)
      return answer.result
    },
    async notify(method, params) {
      await post({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })
    },
    async close() {
      if (!session) return
      await fetch(url, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': session, ...headers },
      }).catch(() => {})
    },
  }
}

/** stdio: one JSON message per line on the child's stdin and stdout. */
function stdioTransport(name: string, config: McpSource): Transport {
  let child: ChildProcessWithoutNullStreams
  try {
    child = spawn(config.command as string, config.args ?? [], {
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new DatasourceError(
      `datasource "${name}": could not start "${config.command}": ${(error as Error).message}`,
      500,
    )
  }
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let nextId = 1
  let buffer = ''
  let stderr = ''
  const fail = (message: string) => {
    for (const waiter of pending.values())
      waiter.reject(new DatasourceError(`datasource "${name}": ${message}`))
    pending.clear()
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (!line) continue
      let message: RpcResponse
      try {
        message = JSON.parse(line) as RpcResponse
      } catch {
        continue // a server's own log line on stdout
      }
      const waiter = message.id === undefined ? undefined : pending.get(message.id)
      if (!waiter) continue
      pending.delete(message.id as number)
      if (message.error)
        waiter.reject(new DatasourceError(`datasource "${name}": ${message.error.message}`))
      else waiter.resolve(message.result)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-500)
  })
  child.on('error', (error) => fail(`could not start "${config.command}": ${error.message}`))
  child.on('exit', (code) =>
    fail(`the server exited (code ${code})${stderr ? `: ${stderr.trim()}` : ''}`),
  )
  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`)
  return {
    request(method, params) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(
            new DatasourceError(
              `datasource "${name}": no answer to ${method} in ${TIMEOUT_MS / 1000}s`,
            ),
          )
        }, TIMEOUT_MS)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        send({ jsonrpc: '2.0', id, method, params })
      })
    },
    async notify(method, params) {
      send({ jsonrpc: '2.0', method, ...(params ? { params } : {}) })
    },
    async close() {
      child.stdin.end()
      child.kill()
    },
  }
}

/** The JSON a tool returned: its structured content, else its first text block parsed. */
function toolOutput(name: string, tool: string, result: unknown): unknown {
  const r = (result ?? {}) as {
    isError?: boolean
    structuredContent?: unknown
    content?: { type: string; text?: string }[]
  }
  const text = r.content?.find((c) => c.type === 'text')?.text
  if (r.isError) {
    throw new DatasourceError(
      `datasource "${name}" tool "${tool}": ${text?.slice(0, 300) ?? 'failed'}`,
    )
  }
  if (r.structuredContent !== undefined) return r.structuredContent
  if (text === undefined)
    throw new DatasourceError(`datasource "${name}" tool "${tool}": returned no text`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new DatasourceError(
      `datasource "${name}" tool "${tool}": returned text that is not JSON — it cannot become a table`,
    )
  }
}

/**
 * An MCP server's tools as tables. The guarantee is weaker than a database's:
 * MCP has no read-only mode, only a tool's own `readOnlyHint`. So a tool is
 * called only when it says it is read-only (or the config explicitly allows
 * tools that say nothing), and never when it says it is destructive.
 */
export async function openMcp(name: string, config: McpSource): Promise<Datasource> {
  if (!config.url && !config.command) {
    throw new DatasourceError(
      `datasource "${name}": give a url (remote server) or a command (local server)`,
      500,
    )
  }
  if (config.url && !/^https?:\/\//i.test(config.url)) {
    throw new DatasourceError(`datasource "${name}": url must be http(s)`, 500)
  }

  let ready:
    | Promise<{
        transport: Transport
        tools: Map<string, Tool>
        server?: { name?: string; version?: string }
      }>
    | undefined
  const connect = () => {
    ready ??= (async () => {
      const transport = config.url
        ? httpTransport(name, config.url, config.headers ?? {})
        : stdioTransport(name, config)
      const hello = (await transport.request('initialize', {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: 'open-dashboard', version: clientVersion() },
      })) as { serverInfo?: { name?: string; version?: string } }
      await transport.notify('notifications/initialized')
      const tools = new Map<string, Tool>()
      let cursor: string | undefined
      do {
        const page = (await transport.request('tools/list', cursor ? { cursor } : {})) as {
          tools?: Tool[]
          nextCursor?: string
        }
        for (const tool of page.tools ?? []) tools.set(tool.name, tool)
        cursor = page.nextCursor
      } while (cursor)
      return { transport, tools, ...(hello?.serverInfo ? { server: hello.serverInfo } : {}) }
    })()
    ready.catch(() => {
      ready = undefined
    })
    return ready
  }

  const allowed = (tools: Map<string, Tool>, table: string, toolName: string): void => {
    const tool = tools.get(toolName)
    if (!tool) {
      throw new DatasourceError(
        `datasource "${name}" table "${table}": the server has no tool "${toolName}"`,
      )
    }
    if (tool.annotations?.destructiveHint === true) {
      throw new DatasourceError(
        `datasource "${name}" table "${table}": tool "${toolName}" says it is destructive — dashboards never call it`,
      )
    }
    if (tool.annotations?.readOnlyHint !== true && !config.allowUnannotated) {
      throw new DatasourceError(
        `datasource "${name}" table "${table}": tool "${toolName}" does not say it is read-only — set allowUnannotated: true only if you know it does not write`,
      )
    }
  }

  return jsonSource({
    name,
    type: 'mcp',
    tables: config.tables ?? {},
    key: (_table, spec, params) =>
      `${spec.tool}\u0000${JSON.stringify(bindTableValue(spec.args ?? {}, params))}`,
    async fetch(table, spec, params) {
      const args = bindTableValue(spec.args ?? {}, params)
      const { transport, tools } = await connect()
      allowed(tools, table, spec.tool)
      return toolOutput(
        name,
        spec.tool,
        await transport.request('tools/call', { name: spec.tool, arguments: args }),
      )
    },
    async tools() {
      const { tools, server } = await connect()
      return {
        ...(server ? { server } : {}),
        tools: [...tools.values()].map((tool) => {
          // Descriptions often open with a keyword line; the first sentence a person reads is after it.
          const lines = (tool.description ?? '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !/^\*\*.*\*\*/.test(line))
          const title = tool.annotations?.title ?? tool.title
          return {
            name: tool.name,
            ...(title ? { title } : {}),
            ...(lines[0] ? { description: lines[0].slice(0, 160) } : {}),
            ...(tool.description
              ? {
                  search: tool.description
                    .replace(/[*#`]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .slice(0, 300),
                }
              : {}),
            ...(tool.annotations?.readOnlyHint !== undefined
              ? { readOnly: tool.annotations.readOnlyHint }
              : {}),
            ...(tool.annotations?.destructiveHint ? { destructive: true } : {}),
          }
        }),
      }
    },
    async close() {
      const open = ready
      ready = undefined
      if (open)
        await open.then(
          ({ transport }) => transport.close(),
          () => {},
        )
    },
  })
}
