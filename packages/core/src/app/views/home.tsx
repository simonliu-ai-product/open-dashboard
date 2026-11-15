import { useEffect, useState } from 'react'
import { driverFor } from '../../datasource/registry.js'
import type { DashboardSummary } from '../../ops/dashboards.js'
import type { SourceStatus } from '../../ops/sources.js'
import { useT } from '../../runtime/i18n.js'
import { readOnly } from '../../runtime/snapshot.js'
import { CommandButton } from '../components/command-button.js'
import { ManageMenu, TitleField } from '../components/dashboard-header.js'
import { CheckIcon } from '../components/icons.js'
import { api } from '../lib/api.js'
import { onNewDashboardRequest } from '../lib/manage-events.js'
import { intervalLabel } from '../lib/refresh.js'
import { linkProps, navigate } from '../lib/router.js'

const COMMANDS = ['/create-dashboard', '/create-chart', '/connect-database', '/apply-comments']

function DashboardRow({ dashboard }: { dashboard: DashboardSummary }) {
  const live = !readOnly()
  const t = useT()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(dashboard.title)
  useEffect(() => setTitle(dashboard.title), [dashboard.title])
  const title_ = renaming ? (
    <TitleField
      title={title}
      editing
      onDone={(next) => {
        setRenaming(false)
        if (!next) return
        setTitle(next)
        api.renameDashboard(dashboard.id, next).catch(() => setTitle(dashboard.title))
      }}
    />
  ) : (
    <span className="odd-board-title">{title}</span>
  )
  return (
    <li className="odd-board-row">
      {renaming ? (
        <div className="odd-board odd-board-renaming">
          <span className="odd-board-main">{title_}</span>
        </div>
      ) : (
        <a className="odd-board" {...linkProps(`/d/${encodeURIComponent(dashboard.id)}`)}>
          <span className="odd-board-main">
            {title_}
            {dashboard.description ? (
              <span className="odd-board-desc">{dashboard.description}</span>
            ) : null}
          </span>
          <dl className="odd-board-meta">
            <div>
              <dt>{t('Panels')}</dt>
              <dd>{dashboard.panels}</dd>
            </div>
            <div>
              <dt>{t('Data')}</dt>
              <dd>{dashboard.sources.length ? dashboard.sources.join(', ') : '—'}</dd>
            </div>
            {live ? (
              <div>
                <dt>{t('Auto-refresh')}</dt>
                <dd>{dashboard.refresh ? intervalLabel(dashboard.refresh, t) : t('Off')}</dd>
              </div>
            ) : null}
          </dl>
        </a>
      )}
      {live ? (
        <ManageMenu
          onRename={() => setRenaming(true)}
          manage={{
            rename: async (next) => {
              await api.renameDashboard(dashboard.id, next)
            },
            duplicate: async () => {
              await api.duplicateDashboard(dashboard.id)
            },
            remove: async () => {
              await api.deleteDashboard(dashboard.id)
              navigate('/', { replace: true })
            },
          }}
        />
      ) : null}
    </li>
  )
}

/**
 * A fresh workspace: connect a database first, then ask for a dashboard. Shown
 * until the first dashboard exists.
 */
function Setup({ sources }: { sources: SourceStatus[] | undefined }) {
  const t = useT()
  const connected = sources?.filter((s) => s.ok) ?? []
  const done = connected.length > 0
  return (
    <ol className="odd-setup">
      <li data-state={done ? 'done' : 'current'}>
        <span className="odd-setup-mark" aria-hidden="true">
          {done ? <CheckIcon /> : '1'}
        </span>
        <div className="odd-setup-body">
          <h2>{t('Connect a database')}</h2>
          {done ? (
            <a className="odd-setup-done" {...linkProps('/data')}>
              {connected.map((s) => s.name).join(', ')}
            </a>
          ) : (
            <CommandButton command="/connect-database" />
          )}
        </div>
      </li>
      <li data-state={done ? 'current' : 'next'}>
        <span className="odd-setup-mark" aria-hidden="true">
          2
        </span>
        <div className="odd-setup-body">
          <h2>{t('Create a dashboard')}</h2>
          {done ? <CommandButton command="/create-dashboard" /> : null}
        </div>
      </li>
    </ol>
  )
}

export function HomeView({
  dashboards,
  sources,
  error,
}: {
  dashboards: DashboardSummary[] | undefined
  sources?: SourceStatus[] | undefined
  error: string | undefined
}) {
  // A built snapshot has no connections to show and nothing to set up.
  const live = !readOnly()
  const t = useT()
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? dashboards?.filter((d) =>
        [d.title, d.description ?? '', d.id, ...d.sources].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : dashboards
  useEffect(
    () =>
      onNewDashboardRequest(() => {
        setCreateError(undefined)
        setCreating(true)
      }),
    [],
  )
  const [createError, setCreateError] = useState<string>()
  const create = async (title?: string) => {
    setCreating(false)
    if (!title) return
    try {
      const made = await api.createDashboard(title)
      navigate(`/d/${encodeURIComponent(made.id)}`)
    } catch (failure) {
      setCreateError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  return (
    <div className="odd-page odd-home">
      <header className="odd-page-head odd-page-head-actions">
        <h1>{t('Dashboards')}</h1>
        {live && dashboards?.length ? (
          <button
            type="button"
            className="odd-button odd-button-primary"
            onClick={() => {
              setCreateError(undefined)
              setCreating(true)
            }}
          >
            {t('New dashboard')}
          </button>
        ) : null}
      </header>

      {error ? <p className="odd-callout odd-callout-error">{error}</p> : null}
      {createError ? <p className="odd-callout odd-callout-error">{createError}</p> : null}

      {dashboards?.length === 0 && live ? (
        <Setup sources={sources} />
      ) : (
        <div className="odd-home-grid" data-single={live ? undefined : ''}>
          <section aria-label={t('Dashboards')}>
            {(dashboards?.length ?? 0) > 4 ? (
              <input
                type="search"
                className="odd-search"
                value={query}
                placeholder={t('Search dashboards')}
                aria-label={t('Search dashboards')}
                onChange={(event) => setQuery(event.target.value)}
              />
            ) : null}
            {needle && shown?.length === 0 ? (
              <p className="odd-boards-empty">
                {t('No dashboards match “{q}”.', { q: query.trim() })}
              </p>
            ) : null}
            <ul className="odd-boards" hidden={Boolean(needle) && shown?.length === 0 && !creating}>
              {creating ? (
                <li className="odd-board-row">
                  <div className="odd-board odd-board-renaming">
                    <span className="odd-board-main">
                      <TitleField
                        title={t('Untitled dashboard')}
                        editing
                        onDone={create}
                        placeholder={t('Dashboard title')}
                      />
                    </span>
                  </div>
                </li>
              ) : null}
              {shown?.map((d) => (
                <DashboardRow key={d.id} dashboard={d} />
              ))}
            </ul>
          </section>

          {live ? (
            <aside className="odd-rail">
              <section className="odd-rail-block" aria-labelledby="odd-sources-heading">
                <header className="odd-rail-head">
                  <h2 id="odd-sources-heading">{t('Data sources')}</h2>
                  <a {...linkProps('/data')}>{t('Browse tables')}</a>
                </header>
                {sources === undefined ? (
                  <p className="odd-muted">{t('Checking connections…')}</p>
                ) : null}
                {sources?.length === 0 ? <CommandButton command="/connect-database" /> : null}
                <ul className="odd-sources">
                  {sources?.map((s) => (
                    <li key={s.name}>
                      <a
                        className="odd-source"
                        {...linkProps(`/data/${encodeURIComponent(s.name)}`)}
                      >
                        <span
                          className="odd-status"
                          data-ok={s.ok}
                          title={s.ok ? t('Connected') : t('Not connected')}
                        >
                          {s.ok ? '●' : '▲'}
                        </span>
                        <span className="odd-source-name">{s.name}</span>
                        <span className="odd-source-type">
                          {driverFor(s.type)?.label ?? s.type}
                        </span>
                        <span className="odd-source-detail">
                          {s.ok ? t('{n} tables', { n: s.tables ?? 0 }) : s.error}
                          {s.default ? <span className="odd-badge">{t('default')}</span> : null}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="odd-rail-block" aria-labelledby="odd-agent-heading">
                <header className="odd-rail-head">
                  <h2 id="odd-agent-heading">{t('Ask your agent')}</h2>
                </header>
                <ul className="odd-commands">
                  {COMMANDS.map((command) => (
                    <li key={command}>
                      <CommandButton command={command} />
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          ) : null}
        </div>
      )}
    </div>
  )
}
