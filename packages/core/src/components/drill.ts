import { useFilters } from '../runtime/context.js'
import { useEdit } from '../runtime/edit.js'
import { snapshot, withBase } from '../runtime/snapshot.js'

/**
 * Click a bar, slice, point or row to filter by it.
 *
 * - `drill="region"` sets this dashboard's `<Select name="region">` to the
 *   clicked category; clicking it again clears it.
 * - `{ filter, dashboard }` opens another dashboard with that filter set.
 * - `{ filter, column }` reads the value from a different column (Table rows).
 */
export type Drill =
  | string
  | { filter: string; column?: string; dashboard?: string; keepFilters?: boolean }

export interface DrillState {
  filter: string
  column: string | undefined
  /** Target dashboard id when drilling across dashboards. */
  dashboard?: string
  /** True when this panel's category is the active filter value. */
  isActive(value: unknown): boolean
  /** True when the filter is set to anything — non-matching marks dim. */
  anyActive: boolean
  pick(value: unknown): void
}

function navigate(path: string): void {
  window.history.pushState(null, '', withBase(path))
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useDrill(drill: Drill | undefined, drillTo?: string): DrillState | undefined {
  const { values, set } = useFilters()
  const { editing } = useEdit()
  if ((!drill && !drillTo) || editing) return undefined
  const base = typeof drill === 'string' ? { filter: drill } : (drill ?? { filter: '' })
  const targetDashboard = base.dashboard ?? drillTo
  // A one-file export holds this dashboard only: there is no other to open.
  if (targetDashboard && snapshot()?.single) return undefined
  const current = targetDashboard || !base.filter ? null : (values[base.filter] ?? null)
  return {
    filter: base.filter,
    column: base.column,
    dashboard: targetDashboard,
    anyActive: current !== null,
    isActive: (value) => current !== null && String(value) === current,
    pick: (value) => {
      if (value === null || value === undefined) return
      const text = String(value)
      if (targetDashboard) {
        const search = new URLSearchParams()
        if (base.keepFilters !== false) {
          for (const [k, v] of Object.entries(values)) {
            if (v !== null && v !== undefined && v !== '') search.set(k, v)
          }
        }
        if (base.filter) search.set(base.filter, text)
        const qs = search.toString()
        navigate(`/d/${encodeURIComponent(targetDashboard)}${qs ? `?${qs}` : ''}`)
        return
      }
      if (!base.filter) return
      set(base.filter, current === text ? null : text)
    },
  }
}
