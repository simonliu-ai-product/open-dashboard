import { snapshot } from '../../runtime/snapshot.js'
import { forgetSnapshotData } from './static-api.js'

/**
 * The Open-X host contract, for a built page inside a page that serves it.
 *
 * The host says `{ type: 'open-x:data-updated' }` once it has put a newer build
 * at the same address. The page answers `open-x:data-updated:ack` and reads its
 * data again in place, keeping the reader's filters and scroll; a host that hears
 * no answer reloads the frame instead. If the new data cannot be read (an access
 * key that has run out, say) the page reloads itself.
 */
export const DATA_UPDATED = 'open-x:data-updated'

/** Dispatched on window when panels should read their data again. */
export const DATA_UPDATED_EVENT = 'odd:data-updated'

export interface HostDeps {
  parent: { postMessage(message: unknown, targetOrigin: string): void }
  /** The new build's `builtAt`, from its dashboards.json; throws when it cannot be read. */
  readBuiltAt(): Promise<string | undefined>
  forget(): void
  setBuiltAt(builtAt: string): void
  refresh(): void
  reload(): void
}

/** What one message from the host does. Returns whether it was the host's to handle. */
export async function onHostMessage(
  source: unknown,
  data: unknown,
  deps: HostDeps,
): Promise<boolean> {
  if (source !== deps.parent) return false
  if ((data as { type?: unknown } | null)?.type !== DATA_UPDATED) return false
  deps.parent.postMessage({ type: `${DATA_UPDATED}:ack` }, '*')
  deps.forget()
  try {
    const builtAt = await deps.readBuiltAt()
    if (builtAt) deps.setBuiltAt(builtAt)
    deps.refresh()
  } catch {
    deps.reload()
  }
  return true
}

export function listenToHost(): () => void {
  if (!snapshot() || typeof window === 'undefined' || window.parent === window) return () => {}
  const deps: HostDeps = {
    parent: window.parent,
    readBuiltAt: async () => {
      const base = new URL(snapshot()?.base ?? '/', window.location.href)
      const res = await fetch(new URL('data/dashboards.json', base), { cache: 'no-store' })
      if (!res.ok) throw new Error(`dashboards.json: ${res.status}`)
      return ((await res.json()) as { builtAt?: string }).builtAt
    },
    forget: forgetSnapshotData,
    setBuiltAt: (builtAt) => {
      const current = snapshot()
      if (current) current.builtAt = builtAt
    },
    refresh: () => window.dispatchEvent(new Event(DATA_UPDATED_EVENT)),
    reload: () => window.location.reload(),
  }
  const onMessage = (event: MessageEvent) => void onHostMessage(event.source, event.data, deps)
  window.addEventListener('message', onMessage)
  return () => window.removeEventListener('message', onMessage)
}
