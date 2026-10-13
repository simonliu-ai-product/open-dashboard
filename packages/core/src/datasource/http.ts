import type { HttpSource, JsonTable } from '../config.js'
import { bindTableValue, type JsonSourceSpec, jsonSource } from './json-tables.js'
import { type Datasource, DatasourceError } from './types.js'

const TIMEOUT_MS = 20_000
const RETRIES = 2
/** Longer than this and a page would rather show the 429 than wait. */
const MAX_RETRY_WAIT_MS = 10_000

/** How long a 429 or 503 asks us to wait: Retry-After in seconds or as a date, else a backoff. */
export function retryDelay(header: string | null, attempt: number, now = Date.now()): number {
  const backoff = 1000 * 2 ** attempt
  if (!header) return backoff
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(header)
  return Number.isNaN(at) ? backoff : Math.max(0, at - now)
}

/**
 * A JSON HTTP API, table by table. Read-only by construction: it only ever
 * sends GET, to URLs written in the config (a query parameter can fill a
 * `:name` in one, URL-encoded, never replace it).
 */
export async function openHttp(
  name: string,
  config: HttpSource,
  reuse: Pick<JsonSourceSpec<JsonTable>, 'store' | 'reuseMs'> = {},
): Promise<Datasource> {
  const urlOf = (template: string, params: Parameters<typeof bindTableValue>[1]): string => {
    const bound = bindTableValue(template, params, encodeURIComponent) as string
    const base = config.baseUrl?.replace(/\/+$/, '')
    const full = /^https?:\/\//i.test(bound) ? bound : `${base ?? ''}/${bound.replace(/^\/+/, '')}`
    if (!/^https?:\/\//i.test(full)) {
      throw new DatasourceError(
        `datasource "${name}": "${template}" is not an http(s) URL — give an absolute URL or a baseUrl`,
        500,
      )
    }
    return full
  }

  return jsonSource({
    name,
    type: 'http',
    tables: config.tables ?? {},
    ...(config.concurrency ? { concurrency: config.concurrency } : {}),
    ...reuse,
    key: (_table, spec, params) => urlOf(spec.url, params),
    async fetch(table, spec, params) {
      const url = urlOf(spec.url, params)
      let response: Response
      for (let attempt = 0; ; attempt++) {
        try {
          response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json', ...config.headers },
            signal: AbortSignal.timeout(TIMEOUT_MS),
          })
        } catch (error) {
          const reason =
            (error as Error).name === 'TimeoutError'
              ? `no answer in ${TIMEOUT_MS / 1000}s`
              : (error as Error).message
          throw new DatasourceError(`datasource "${name}" table "${table}": ${reason}`)
        }
        if ((response.status !== 429 && response.status !== 503) || attempt >= RETRIES) break
        const wait = retryDelay(response.headers.get('retry-after'), attempt)
        if (wait > MAX_RETRY_WAIT_MS) break
        await response.body?.cancel()
        await new Promise((resolve) => setTimeout(resolve, wait))
      }
      const text = await response.text()
      if (!response.ok) {
        throw new DatasourceError(
          `datasource "${name}" table "${table}": HTTP ${response.status} ${response.statusText} — ${text.slice(0, 200)}`,
        )
      }
      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new DatasourceError(
          `datasource "${name}" table "${table}": the response is not JSON (${response.headers.get('content-type') ?? 'no content type'})`,
        )
      }
    },
  })
}
