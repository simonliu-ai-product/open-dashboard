import { useEffect, useState } from 'react'
import type { DashboardSummary } from '../ops/dashboards.js'
import { LocaleProvider, useT } from '../runtime/i18n.js'
import { SettingsMenu } from './components/settings-menu.js'
import { api } from './lib/api.js'
import { linkProps, useRoute } from './lib/router.js'
import { useTheme } from './lib/theme.js'
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

function Shell() {
  const t = useT()
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
            aria-label={t('Menu')}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
        <nav className="odd-nav" aria-label={t('Main')}>
          <a {...linkProps('/')} aria-current={route.name === 'home' ? 'page' : undefined}>
            {t('Overview')}
          </a>
          <a {...linkProps('/data')} aria-current={route.name === 'data' ? 'page' : undefined}>
            {t('Data sources')}
          </a>
          <h2 className="odd-nav-heading">
            {t('Dashboards')}
            {dashboards.list ? <span className="odd-count">{dashboards.list.length}</span> : null}
          </h2>
          {dashboards.list?.map((d) => (
            <a
              key={d.id}
              {...linkProps(`/d/${encodeURIComponent(d.id)}`)}
              aria-current={route.name === 'dashboard' && route.id === d.id ? 'page' : undefined}
            >
              {d.title}
            </a>
          ))}
        </nav>
        <SettingsMenu theme={theme} onTheme={setTheme} />
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

export function App() {
  return (
    <LocaleProvider>
      <Shell />
    </LocaleProvider>
  )
}
