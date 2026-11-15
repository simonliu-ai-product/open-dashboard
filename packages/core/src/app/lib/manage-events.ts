/**
 * The command palette asks for dashboard actions by event, so the header's ⋯
 * menu stays the one place they run — a delete still needs its second click.
 */
export type ManageAction = 'rename' | 'duplicate' | 'delete'

const EVENT = 'odd:manage-dashboard'
const NEW_EVENT = 'odd:new-dashboard'
let pendingNew = false

export function requestManage(action: ManageAction): void {
  window.dispatchEvent(new CustomEvent<ManageAction>(EVENT, { detail: action }))
}

export function onManageRequest(handler: (action: ManageAction) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<ManageAction>).detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

/** Opens the home page's new-dashboard field, now if it is showing, or once it mounts. */
export function requestNewDashboard(): void {
  pendingNew = true
  window.dispatchEvent(new CustomEvent(NEW_EVENT))
}

export function onNewDashboardRequest(handler: () => void): () => void {
  const take = () => {
    if (!pendingNew) return
    pendingNew = false
    handler()
  }
  take()
  window.addEventListener(NEW_EVENT, take)
  return () => window.removeEventListener(NEW_EVENT, take)
}
