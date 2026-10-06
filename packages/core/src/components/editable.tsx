import type { ComponentType } from 'react'
import { applyProps } from '../runtime/convert.js'
import { usePanelEdit } from '../runtime/edit.js'

// biome-ignore lint/suspicious/noExplicitAny: panels take differing props; each registers its own
const IMPLEMENTATIONS: Record<string, ComponentType<any>> = {}

/** A built-in panel's implementation by name — the Charts page draws examples with it. */
export function panelImplementation(
  name: string,
): ComponentType<Record<string, unknown>> | undefined {
  return IMPLEMENTATIONS[name]
}

/**
 * A panel as the dashboard source declares it, with the page's staged edits on
 * top — including a change of type, which renders the other panel's
 * implementation with the converted props.
 */
export function editable<P extends { title: string }>(
  name: string,
  Impl: ComponentType<P>,
): ComponentType<P> {
  IMPLEMENTATIONS[name] = Impl
  function Editable(props: P) {
    const edit = usePanelEdit(props.title)
    if (!edit) return <Impl {...props} />
    const merged = applyProps(props as Record<string, unknown>, edit.changes) as P
    const Target = (edit.component && IMPLEMENTATIONS[edit.component]) || Impl
    return <Target {...merged} />
  }
  Editable.displayName = name
  return Editable
}
