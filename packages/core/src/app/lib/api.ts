import type { ParamValue, SchemaInfo } from '../../config.js'
import type { DashboardSummary } from '../../ops/dashboards.js'
import type { SourceStatus } from '../../ops/sources.js'
import type { QueryRun } from '../../runtime/types.js'

const BASE = '/__odd/api/'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, init)
  const body = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
  return body
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export const api = {
  dashboards: () =>
    request<{ dashboards: DashboardSummary[] }>('dashboards').then((r) => r.dashboards),
  sources: () => request<{ sources: SourceStatus[] }>('sources').then((r) => r.sources),
  schema: (source: string) => request<SchemaInfo>(`schema?source=${encodeURIComponent(source)}`),
  query: (id: string, name: string, params: Record<string, ParamValue>) =>
    request<QueryRun>(
      `query?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&params=${encodeURIComponent(JSON.stringify(params))}`,
    ),
  comments: (id: string) =>
    request<{ comments: { line: number; text: string }[] }>(
      `comments?id=${encodeURIComponent(id)}`,
    ).then((r) => r.comments),
  comment: (id: string, panel: string, text: string) =>
    post<{ file: string; line: number }>('comment', { id, panel, text }),
  current: (view: Record<string, unknown>) => post('current', view).catch(() => {}),
}
