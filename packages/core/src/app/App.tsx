import { useEffect, useState } from 'react'
import { driverFor } from '../datasource/registry.js'
import type { DashboardSummary } from '../ops/dashboards.js'
import type { SourceStatus } from '../ops/sources.js'
import { LocaleProvider, useT } from '../runtime/i18n.js'
import { snapshot } from '../runtime/snapshot.js'
import { ChevronIcon } from './components/icons.js'
import { SettingsMenu } from './components/settings-menu.js'
import { api } from './lib/api.js'
import { linkProps, useRoute } from './lib/router.js'
import { useTheme } from './lib/theme.js'
import { ChartsView } from './views/charts.js'
import { DashboardView } from './views/dashboard.js'
import { DataSourcesView } from './views/data.js'
import { HomeView } from './views/home.js'
import { ThemesView } from './views/themes.js'

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

function useSources(): SourceStatus[] | undefined {
  const [list, setList] = useState<SourceStatus[]>()
  useEffect(() => {
    const load = () => api.sources().then(setList, () => setList([]))
    load()
    // Config and .env edits arrive as a change with no dashboard id.
    const reload = (data: unknown) => {
      if (!(data as { id?: string } | undefined)?.id) load()
    }
    import.meta.hot?.on('odd:queries-changed', reload)
    return () => import.meta.hot?.off?.('odd:queries-changed', reload)
  }, [])
  return list
}

const SOURCES_OPEN = 'odd:nav-sources'

function useSourcesOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(SOURCES_OPEN) !== 'closed'
    } catch {
      return true
    }
  })
  const update = (next: boolean) => {
    setOpen(next)
    try {
      if (next) localStorage.removeItem(SOURCES_OPEN)
      else localStorage.setItem(SOURCES_OPEN, 'closed')
    } catch {
      // the choice just isn't remembered
    }
  }
  return [open, update]
}

function Shell() {
  const t = useT()
  const route = useRoute()
  const [theme, setTheme] = useTheme()
  const dashboards = useDashboards()
  const sources = useSources()
  const [sourcesOpen, setSourcesOpen] = useSourcesOpen()
  // /data without a name shows the default source, as the page itself does.
  const shownSource = sources?.find((s) => s.default)?.name ?? sources?.[0]?.name
  const [menuOpen, setMenuOpen] = useState(false)
  // A built snapshot has dashboards and nothing that needs the database or writes a file.
  const live = snapshot() === undefined

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
          {live ? (
            <>
              <div className="odd-nav-group">
                <a
                  {...linkProps('/data')}
                  aria-current={
                    // Collapsed (or with nothing to list), the group stands in for the database shown.
                    route.name === 'data' && (!sourcesOpen || !sources?.length) ? 'page' : undefined
                  }
                >
                  {t('Data sources')}
                </a>
                {sources?.length ? (
                  <button
                    type="button"
                    className="odd-nav-toggle"
                    aria-expanded={sourcesOpen}
                    aria-controls="odd-nav-sources"
                    aria-label={sourcesOpen ? t('Hide databases') : t('Show databases')}
                    onClick={() => setSourcesOpen(!sourcesOpen)}
                  >
                    <ChevronIcon />
                  </button>
                ) : null}
              </div>
              {sourcesOpen && sources?.length ? (
                <div id="odd-nav-sources" className="odd-nav-sub">
                  {sources.map((s) => (
                    <a
                      key={s.name}
                      {...linkProps(`/data/${encodeURIComponent(s.name)}`)}
                      aria-current={
                        route.name === 'data' && (route.source ?? shownSource) === s.name
                          ? 'page'
                          : undefined
                      }
                      title={s.ok ? undefined : s.error}
                    >
                      <span
                        className="odd-status"
                        data-ok={s.ok}
                        role="img"
                        aria-label={s.ok ? t('Connected') : t('Not connected')}
                      >
                        {s.ok ? '●' : '▲'}
                      </span>
                      <span className="odd-nav-sub-name">{s.name}</span>
                      <span className="odd-nav-sub-type">{driverFor(s.type)?.label ?? s.type}</span>
                    </a>
                  ))}
                </div>
              ) : null}
              <a
                {...linkProps('/charts')}
                aria-current={route.name === 'charts' ? 'page' : undefined}
              >
                {t('Charts')}
              </a>
              <a
                {...linkProps('/themes')}
                aria-current={route.name === 'themes' ? 'page' : undefined}
              >
                {t('Themes')}
              </a>
            </>
          ) : null}
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
        ) : !live ? (
          <HomeView dashboards={dashboards.list} error={dashboards.error} />
        ) : route.name === 'charts' ? (
          <ChartsView dashboards={dashboards.list} {...(route.id ? { id: route.id } : {})} />
        ) : route.name === 'themes' ? (
          <ThemesView
            key={route.id ?? ''}
            dashboards={dashboards.list}
            {...(route.id ? { id: route.id } : {})}
          />
        ) : route.name === 'data' ? (
          <DataSourcesView sources={sources} {...(route.source ? { source: route.source } : {})} />
        ) : (
          <HomeView dashboards={dashboards.list} sources={sources} error={dashboards.error} />
        )}
      </main>
    </div>
  )
}

export function App() {
  // A one-file export is that dashboard alone: no other page to go to.
  const single = snapshot()?.single ? snapshot()?.route?.replace(/^\/d\//, '') : undefined
  return (
    <LocaleProvider>
      {single ? (
        <main className="odd-main odd-standalone">
          <DashboardView id={single} />
        </main>
      ) : (
        <Shell />
      )}
    </LocaleProvider>
  )
}
