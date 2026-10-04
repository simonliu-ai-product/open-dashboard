import type { HttpSource } from '../config.js'
import { bindTableValue, jsonSource } from './json-tables.js'
import { type Datasource, DatasourceError } from './types.js'

const TIMEOUT_MS = 20_000

/**
 * A JSON HTTP API, table by table. Read-only by construction: it only ever
 * sends GET, to URLs written in the config (a query parameter can fill a
 * `:name` in one, URL-encoded, never replace it).
 */
export async function openHttp(name: string, config: HttpSource): Promise<Datasource> {
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
    key: (_table, spec, params) => urlOf(spec.url, params),
    async fetch(table, spec, params) {
      const url = urlOf(spec.url, params)
      let response: Response
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
