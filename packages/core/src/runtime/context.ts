import { type Context, createContext, useContext } from 'react'
import type { ParamValue } from '../config.js'
import type { DashboardMeta, PanelInfo, QueryRun } from './types.js'

export interface HostContextValue {
  id: string
  meta: DashboardMeta
  /** Bumped by manual refresh, auto-refresh, and edits to the dashboard's .sql files. */
  tick: number
  refresh(): void
  inspect(panel: PanelInfo, run: QueryRun | undefined): void
  /** False where there is no inspector to open (previews): panels then show no Inspect button. */
  inspectable?: boolean
  onParams(params: Record<string, ParamValue>): void
  fetchQuery(name: string, params: Record<string, ParamValue>): Promise<QueryRun>
  /** Filter values set from outside the filters — the assistant's switch; `seq` makes each one new. */
  filterOverride?: { values: Record<string, string | null>; seq: number }
}

export interface FilterState {
  values: Record<string, string | null>
  params: Record<string, ParamValue>
  set(key: string, value: string | null): void
}

/**
 * Stashed on globalThis: if a second copy of this module is ever loaded (a
 * dashboard resolving core differently from the viewer), both still share one
 * context instead of panels silently rendering with no host.
 */
const store = globalThis as typeof globalThis & {
  __openDashboardContexts?: {
    host: Context<HostContextValue | null>
    filters: Context<FilterState>
  }
}

store.__openDashboardContexts ??= {
  host: createContext<HostContextValue | null>(null),
  filters: createContext<FilterState>({ values: {}, params: {}, set: () => {} }),
}

export const HostContext = store.__openDashboardContexts.host
export const FilterContext = store.__openDashboardContexts.filters

export function useHost(): HostContextValue {
  const host = useContext(HostContext)
  if (!host)
    throw new Error('open-dashboard components must render inside the open-dashboard viewer')
  return host
}

export function useFilters(): FilterState {
  return useContext(FilterContext)
}
