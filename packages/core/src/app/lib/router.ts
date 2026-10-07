import { useEffect, useState } from 'react'
import { snapshot, stripBase, withBase } from '../../runtime/snapshot.js'

export type Route =
  | { name: 'home' }
  | { name: 'dashboard'; id: string }
  | { name: 'data'; source?: string }
  | { name: 'charts'; id?: string }
  | { name: 'themes'; id?: string }

export function parseRoute(pathname: string): Route {
  const dashboard = /^\/d\/([^/]+)\/?$/.exec(pathname)
  if (dashboard?.[1]) return { name: 'dashboard', id: decodeURIComponent(dashboard[1]) }
  const data = /^\/data(?:\/([^/]+))?\/?$/.exec(pathname)
  if (data)
    return data[1] ? { name: 'data', source: decodeURIComponent(data[1]) } : { name: 'data' }
  for (const name of ['charts', 'themes'] as const) {
    const match = new RegExp(`^/${name}(?:/([^/]+))?/?$`).exec(pathname)
    if (match) return match[1] ? { name, id: decodeURIComponent(match[1]) } : { name }
  }
  return { name: 'home' }
}

let guard: (() => boolean) | undefined
let shown = typeof window === 'undefined' ? '' : window.location.pathname + window.location.search

function current(): string {
  return window.location.pathname + window.location.search
}

/**
 * While unsaved changes are open, leaving the page is refused rather than
 * losing them: the guard returns true to block, and shows why on its own.
 */
export function setNavigationGuard(next: (() => boolean) | undefined): () => void {
  guard = next
  return () => {
    if (guard === next) guard = undefined
  }
}

/** `replace` for a redirect: the address it leaves is not one the back button should return to. */
export function navigate(path: string, options: { replace?: boolean } = {}): void {
  const address = withBase(path)
  if (address === current()) return
  if (guard?.()) return
  if (options.replace) window.history.replaceState(null, '', address)
  else window.history.pushState(null, '', address)
  shown = address
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() =>
    parseRoute(snapshot()?.route ?? stripBase(window.location.pathname)),
  )
  useEffect(() => {
    const update = () => {
      const now = current()
      // The back button already moved the address; put it back.
      if (now !== shown && guard?.()) {
        window.history.pushState(null, '', shown)
        return
      }
      shown = now
      setRoute(parseRoute(snapshot()?.route ?? stripBase(window.location.pathname)))
    }
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  return route
}

/** An in-app link: a real <a> for middle-click and copy, routed without a reload. */
export function linkProps(path: string) {
  return {
    href: withBase(path),
    onClick: (event: React.MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      navigate(path)
    },
  }
}
