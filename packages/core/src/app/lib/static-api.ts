import type { ParamValue } from '../../config.js'
import { snapshot, snapshotKey } from '../../runtime/snapshot.js'
import type { QueryRun } from '../../runtime/types.js'
import type { Api } from './api.js'

/** One query's stored results, as `open-dashboard build` writes them. */
export interface SnapshotQueryFile {
  reads: string[]
  results: Record<string, QueryRun | { error: string }>
}

export const NOT_IN_SNAPSHOT = 'Not in this snapshot: it was built without these filter values'

function unavailable(): Promise<never> {
  return Promise.reject(new Error('Not available in a snapshot'))
}

/**
 * The read side of the API over the files `open-dashboard build` wrote under
 * `data/`. Everything that writes, or needs a live database, is refused —
 * the viewer hides those controls in a snapshot.
 */
export function staticApi(): Api {
  const loaded = new Map<string, Promise<unknown>>()
  // A one-file export carries its data inline.
  const inline = (globalThis as { __ODD_DATA__?: Record<string, unknown> }).__ODD_DATA__
  const load = <T>(path: string): Promise<T> => {
    if (inline)
      return path in inline
        ? Promise.resolve(inline[path] as T)
        : Promise.reject(new Error(NOT_IN_SNAPSHOT))
    let pending = loaded.get(path)
    if (!pending) {
      const base = new URL(snapshot()?.base ?? '/', window.location.origin)
      pending = fetch(new URL(`data/${path}`, base)).then((response) => {
        if (!response.ok) throw new Error(NOT_IN_SNAPSHOT)
        return response.json()
      })
      pending.catch(() => loaded.delete(path))
      loaded.set(path, pending)
    }
    return pending as Promise<T>
  }
  const query = async (
    folder: string,
    id: string,
    name: string,
    params: Record<string, ParamValue>,
  ): Promise<QueryRun> => {
    const file = await load<SnapshotQueryFile>(
      `${folder}/${encodeURIComponent(id)}/${encodeURIComponent(name)}.json`,
    )
    const hit = file.results[snapshotKey(params, file.reads)]
    if (!hit) throw new Error(NOT_IN_SNAPSHOT)
    if ('error' in hit) throw new Error(hit.error)
    return { ...hit, params }
  }

  return {
    dashboards: () =>
      load<{ dashboards: Awaited<ReturnType<Api['dashboards']>> }>('dashboards.json').then(
        (r) => r.dashboards,
      ),
    sources: async () => [],
    sourceDetail: unavailable,
    databaseDoc: unavailable,
    schema: unavailable,
    query: (id, name, params) => query('d', id, name, params),
    queryHistory: unavailable,
    comments: async () => [],
    comment: unavailable,
    current: async () => {},
    layout: unavailable,
    saveLayout: unavailable,
    charts: async () => [],
    chartQuery: unavailable,
    assistant: async () => ({ enabled: false }),
    ask: unavailable,
    collectors: async () => [],
    collect: unavailable,
    exportHtml: unavailable,
    themes: () => load('themes.json'),
    theme: (id) => load(`themes/${encodeURIComponent(id)}.json`),
    saveTheme: unavailable,
  }
}
