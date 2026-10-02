import { useEffect, useState } from 'react'
import { driverFor } from '../../datasource/registry.js'
import type { DashboardSummary } from '../../ops/dashboards.js'
import type { SourceStatus } from '../../ops/sources.js'
import { useT } from '../../runtime/i18n.js'
import { CommandButton } from '../components/command-button.js'
import { CheckIcon } from '../components/icons.js'
import { api } from '../lib/api.js'
import { intervalLabel } from '../lib/refresh.js'
import { linkProps } from '../lib/router.js'

const COMMANDS = [
  {
    command: '/create-dashboard',
    text: 'Describe what you want to see. Your agent writes the SQL and the panels, and they appear here as it works.',
  },
  {
    command: '/connect-database',
    text: 'Connect Postgres, MySQL, SQL Server, Oracle, ClickHouse, BigQuery, Snowflake, DuckDB or SQLite.',
  },
  {
    command: '/apply-comments',
    text: 'Apply the notes you left on panels in the inspector.',
  },
]

function DashboardRow({ dashboard }: { dashboard: DashboardSummary }) {
  const t = useT()
  return (
    <li>
      <a className="odd-board" {...linkProps(`/d/${encodeURIComponent(dashboard.id)}`)}>
        <span className="odd-board-main">
          <span className="odd-board-title">{dashboard.title}</span>
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
          <div>
            <dt>{t('Auto-refresh')}</dt>
            <dd>{dashboard.refresh ? intervalLabel(dashboard.refresh, t) : t('Off')}</dd>
          </div>
        </dl>
      </a>
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
  error,
}: {
  dashboards: DashboardSummary[] | undefined
  error: string | undefined
}) {
  const t = useT()
  const [sources, setSources] = useState<SourceStatus[]>()
  useEffect(() => {
    api.sources().then(setSources, () => setSources([]))
  }, [])

  return (
    <div className="odd-page odd-home">
      <header className="odd-page-head">
        <h1>{t('Dashboards')}</h1>
      </header>

      {error ? <p className="odd-callout odd-callout-error">{error}</p> : null}

      {dashboards?.length === 0 ? (
        <Setup sources={sources} />
      ) : (
        <div className="odd-home-grid">
          <section aria-label={t('Dashboards')}>
            <ul className="odd-boards">
              {dashboards?.map((d) => (
                <DashboardRow key={d.id} dashboard={d} />
              ))}
            </ul>
          </section>

          <aside className="odd-rail">
            <section className="odd-rail-block" aria-labelledby="odd-sources-heading">
              <header className="odd-rail-head">
                <h2 id="odd-sources-heading">{t('Data sources')}</h2>
                <a {...linkProps('/data')}>{t('Browse tables')}</a>
              </header>
              {sources === undefined ? (
                <p className="odd-muted">{t('Checking connections…')}</p>
              ) : null}
              {sources?.length === 0 ? (
                <p className="odd-muted">
                  {t('None configured yet. Ask your agent: /connect-database')}
                </p>
              ) : null}
              <ul className="odd-sources">
                {sources?.map((s) => (
                  <li key={s.name}>
                    <a className="odd-source" {...linkProps(`/data/${encodeURIComponent(s.name)}`)}>
                      <span
                        className="odd-status"
                        data-ok={s.ok}
                        title={s.ok ? t('Connected') : t('Not connected')}
                      >
                        {s.ok ? '●' : '▲'}
                      </span>
                      <span className="odd-source-name">{s.name}</span>
                      <span className="odd-source-type">{driverFor(s.type)?.label ?? s.type}</span>
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
                {COMMANDS.map((c) => (
                  <li key={c.command}>
                    <CommandButton {...c} />
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}
    </div>
  )
}
