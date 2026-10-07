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
export type Drill = string | { filter: string; column?: string; dashboard?: string }

export interface DrillState {
  filter: string
  column: string | undefined
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

export function useDrill(drill: Drill | undefined): DrillState | undefined {
  const { values, set } = useFilters()
  const { editing } = useEdit()
  if (!drill || editing) return undefined
  const spec = typeof drill === 'string' ? { filter: drill } : drill
  // A one-file export holds this dashboard only: there is no other to open.
  if (spec.dashboard && snapshot()?.single) return undefined
  const current = spec.dashboard ? null : (values[spec.filter] ?? null)
  return {
    filter: spec.filter,
    column: spec.column,
    anyActive: current !== null,
    isActive: (value) => current !== null && String(value) === current,
    pick: (value) => {
      if (value === null || value === undefined) return
      const text = String(value)
      if (spec.dashboard) {
        navigate(
          `/d/${encodeURIComponent(spec.dashboard)}?${encodeURIComponent(spec.filter)}=${encodeURIComponent(text)}`,
        )
        return
      }
      set(spec.filter, current === text ? null : text)
    },
  }
}
