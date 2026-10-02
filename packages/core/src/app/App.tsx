import { useEffect, useState } from 'react'
import type { DashboardSummary } from '../ops/dashboards.js'
import { api } from './lib/api.js'
import { linkProps, useRoute } from './lib/router.js'
import { type Theme, useTheme } from './lib/theme.js'
import { DashboardView } from './views/dashboard.js'
import { DataSourcesView } from './views/data.js'
import { HomeView } from './views/home.js'

function useDashboards(): { list: DashboardSummary[] | undefined; error: string | undefined } {
  const [list, setList] = useState<DashboardSummary[]>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    const load = () =>
      api.dashboards().then(
        (found) => {
          setList(found)
          setError(undefined)
        },
        (e: Error) => setError(e.message),
      )
    load()
    const reload = () => load()
    import.meta.hot?.on('odd:queries-changed', reload)
    return () => import.meta.hot?.off?.('odd:queries-changed', reload)
  }, [])
  return { list, error }
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function App() {
  const route = useRoute()
  const [theme, setTheme] = useTheme()
  const dashboards = useDashboards()
  const [menuOpen, setMenuOpen] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the menu whenever the route changes
  useEffect(() => setMenuOpen(false), [route])

  return (
    <div className="odd-shell" data-menu={menuOpen || undefined}>
      <aside className="odd-sidebar">
        <div className="odd-brand">
          <a {...linkProps('/')} className="odd-brand-link">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <rect x="2" y="10" width="4" height="8" rx="1" fill="var(--odd-series-1)" />
              <rect x="8" y="5" width="4" height="13" rx="1" fill="var(--odd-series-3)" />
              <rect x="14" y="2" width="4" height="16" rx="1" fill="var(--odd-series-2)" />
            </svg>
            open-dashboard
          </a>
          <button
            type="button"
            className="odd-menu-toggle"
            aria-label="Menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
        <nav className="odd-nav" aria-label="Main">
          <a {...linkProps('/')} aria-current={route.name === 'home' ? 'page' : undefined}>
            Overview
          </a>
          <a {...linkProps('/data')} aria-current={route.name === 'data' ? 'page' : undefined}>
            Data sources
          </a>
          <div className="odd-nav-heading">Dashboards</div>
          {dashboards.list?.map((d) => (
            <a
              key={d.id}
              {...linkProps(`/d/${encodeURIComponent(d.id)}`)}
              aria-current={route.name === 'dashboard' && route.id === d.id ? 'page' : undefined}
            >
              {d.title}
            </a>
          ))}
          {dashboards.list?.length === 0 ? <p className="odd-nav-empty">None yet</p> : null}
        </nav>
        <fieldset className="odd-theme" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={theme === t.value}
              onClick={() => setTheme(t.value)}
            >
              {t.label}
            </button>
          ))}
        </fieldset>
      </aside>
      <main className="odd-main">
        {route.name === 'dashboard' ? (
          <DashboardView key={route.id} id={route.id} />
        ) : route.name === 'data' ? (
          <DataSourcesView {...(route.source ? { source: route.source } : {})} />
        ) : (
          <HomeView dashboards={dashboards.list} error={dashboards.error} />
        )}
      </main>
    </div>
  )
}
