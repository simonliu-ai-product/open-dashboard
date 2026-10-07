import type { ParamValue, SchemaInfo } from '../../config.js'
import type { CatalogEntry } from '../../ops/charts.js'
import type { CollectorRun, CollectorStatus } from '../../ops/collectors.js'
import type { DashboardSummary } from '../../ops/dashboards.js'
import type { DatabaseDoc } from '../../ops/database-doc.js'
import type { DashboardLayout, LayoutEdit } from '../../ops/layout.js'
import type { SourceDetail, SourceStatus } from '../../ops/sources.js'
import type { ThemeFile, ThemeList } from '../../ops/themes.js'
import { snapshot } from '../../runtime/snapshot.js'
import type { DashboardTheme } from '../../runtime/theme.js'
import type { QueryRun } from '../../runtime/types.js'
import { staticApi } from './static-api.js'

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

export const liveApi = {
  dashboards: () =>
    request<{ dashboards: DashboardSummary[] }>('dashboards').then((r) => r.dashboards),
  sources: () => request<{ sources: SourceStatus[] }>('sources').then((r) => r.sources),
  sourceDetail: (source: string) =>
    request<SourceDetail>(`source-detail?source=${encodeURIComponent(source)}`),
  databaseDoc: (source: string) =>
    request<DatabaseDoc>(`database-doc?source=${encodeURIComponent(source)}`),
  schema: (source: string) => request<SchemaInfo>(`schema?source=${encodeURIComponent(source)}`),
  query: (id: string, name: string, params: Record<string, ParamValue>, fresh = false) =>
    request<QueryRun>(
      `query?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&params=${encodeURIComponent(JSON.stringify(params))}${fresh ? '&fresh=1' : ''}`,
    ),
  comments: (id: string) =>
    request<{ comments: { line: number; text: string }[] }>(
      `comments?id=${encodeURIComponent(id)}`,
    ).then((r) => r.comments),
  comment: (id: string, panel: string, text: string) =>
    post<{ file: string; line: number }>('comment', { id, panel, text }),
  current: (view: Record<string, unknown>) => post('current', view).catch(() => {}),
  layout: (id: string) => request<DashboardLayout>(`layout?id=${encodeURIComponent(id)}`),
  saveLayout: (id: string, hash: string, edits: LayoutEdit[]) =>
    post<{ hash: string }>('layout', { id, hash, edits }),
  charts: () => request<{ charts: CatalogEntry[] }>('charts').then((r) => r.charts),
  chartQuery: (id: string, name: string, params: Record<string, ParamValue>, fresh = false) =>
    request<QueryRun>(
      `chart-query?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}&params=${encodeURIComponent(JSON.stringify(params))}${fresh ? '&fresh=1' : ''}`,
    ),
  assistant: () => request<{ enabled: boolean }>('assistant'),
  /** The reply as it streams in; `onText` gets the whole reply so far. */
  ask: async (
    id: string,
    params: Record<string, ParamValue>,
    messages: { role: 'user' | 'assistant'; content: string }[],
    onUpdate: (reply: { thought: string; text: string }) => void,
    signal: AbortSignal,
  ): Promise<{ thought: string; text: string }> => {
    const response = await fetch(`${BASE}assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, params, messages }),
      signal,
    })
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `${response.status} ${response.statusText}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const reply = { thought: '', text: '' }
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        const piece = JSON.parse(line) as { thought?: string; text?: string; error?: string }
        if (piece.error) throw new Error(piece.error)
        reply.thought += piece.thought ?? ''
        reply.text += piece.text ?? ''
      }
      onUpdate({ ...reply })
    }
    return reply
  },
  collectors: () =>
    request<{ collectors: CollectorStatus[] }>('collectors').then((r) => r.collectors),
  collect: (id: string) => post<CollectorRun>('collect', { id }),
  /** The dashboard as one HTML file, opening at the filters in `search`. */
  exportHtml: async (id: string, search: string): Promise<Blob> => {
    const response = await fetch(
      `${BASE}export-html?id=${encodeURIComponent(id)}&search=${encodeURIComponent(search)}`,
    )
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `${response.status} ${response.statusText}`)
    }
    return response.blob()
  },
  themes: () => request<ThemeList>('themes'),
  theme: (id: string) => request<ThemeFile>(`theme?id=${encodeURIComponent(id)}`),
  saveTheme: (id: string, hash: string, theme: DashboardTheme) =>
    post<{ hash: string }>('theme', { id, hash, theme }),
}

export type Api = typeof liveApi

/** A page built by `open-dashboard build` reads stored results; the dev server is not there. */
export const api: Api = snapshot() ? staticApi() : liveApi
