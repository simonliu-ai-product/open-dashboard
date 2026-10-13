import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ParamValue } from '../config.js'
import { redact, redactValue } from '../datasource/redact.js'
import { errorMessage } from '../datasource/types.js'
import {
  type AnswerEvent,
  answer,
  assistantInstructions,
  OpsError,
  validateMessages,
} from '../ops/index.js'
import type { Workspace } from '../workspace.js'

/** What the dev API and `open-dashboard serve` share: replies, bodies, the origin check, the assistant. */

export interface Res {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: string): void
}

export function json(res: Res, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Errors are masked where they are made; this is the last check before the
  // wire. Query results are not touched: they are the user's data.
  const safe = status >= 400 && body && typeof body === 'object' ? redactValue(body) : body
  res.end(JSON.stringify(safe))
}

/** Notes and layout edits are small; anything bigger is refused before it is held in memory. */
const MAX_BODY = 1024 * 1024

export async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new OpsError('request body over 1 MB', 413)
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

/**
 * These handlers write to the user's disk and read their database, so a page on
 * another origin must not be able to call them through the user's browser.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function parseParams(raw: string | null): Record<string, ParamValue> {
  if (!raw) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new OpsError('params must be an object')
  const out: Record<string, ParamValue> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
      out[key] = value as ParamValue
    else throw new OpsError(`param "${key}" must be a string, number, boolean, or null`)
  }
  return out
}

/** `POST assistant`: the answer streamed as NDJSON, from the page's results, never the database. */
export async function askAssistant(
  workspace: Workspace,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const assistant = workspace.config.assistant
  if (!assistant) return json(res, 404, { error: 'the assistant is not configured' })
  const body = await readBody(req)
  if (typeof body.id !== 'string') return json(res, 400, { error: 'id is required' })
  const params = parseParams(body.params ? JSON.stringify(body.params) : null)
  const messages = validateMessages(body.messages)
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  // The reader's filter values, as their address has them: what a switch starts from.
  const values =
    typeof body.search === 'string'
      ? Object.fromEntries(
          [...new URLSearchParams(body.search)].map(([key, value]) => [
            key,
            value === '' ? null : value,
          ]),
        )
      : undefined
  const stream = answer(workspace, assistant, body.id, params, messages, {
    ...(values ? { values } : {}),
    instructions: assistantInstructions(workspace.config, body.id),
    signal: controller.signal,
  })
  // The first piece is awaited before any header goes out, so a refused
  // key or an unknown model comes back as an ordinary JSON error.
  const first = await stream.next()
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // One JSON object per line: { thought } while the model thinks, { read } and
  // { switched } as it uses its tools, { text } for the answer.
  const send = (line: Record<string, unknown>) => res.write(`${JSON.stringify(line)}\n`)
  const write = (event: AnswerEvent) => {
    if (event.kind === 'read') send({ read: event.panels })
    else if (event.kind === 'switched') send({ switched: event.switched })
    else send(event.kind === 'thought' ? { thought: event.text } : { text: event.text })
  }
  if (!first.done) write(first.value)
  try {
    for await (const event of stream) write(event)
  } catch (error) {
    if (!controller.signal.aborted) send({ error: redact(errorMessage(error)) })
  }
  res.end()
}
