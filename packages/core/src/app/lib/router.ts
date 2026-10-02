import { useEffect, useState } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'dashboard'; id: string }
  | { name: 'data'; source?: string }

export function parseRoute(pathname: string): Route {
  const dashboard = /^\/d\/([^/]+)\/?$/.exec(pathname)
  if (dashboard?.[1]) return { name: 'dashboard', id: decodeURIComponent(dashboard[1]) }
  const data = /^\/data(?:\/([^/]+))?\/?$/.exec(pathname)
  if (data)
    return data[1] ? { name: 'data', source: decodeURIComponent(data[1]) } : { name: 'data' }
  return { name: 'home' }
}

export function navigate(path: string): void {
  if (path === window.location.pathname + window.location.search) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  return route
}

/** An in-app link: a real <a> for middle-click and copy, routed without a reload. */
export function linkProps(path: string) {
  return {
    href: path,
    onClick: (event: React.MouseEvent) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      navigate(path)
    },
  }
}
