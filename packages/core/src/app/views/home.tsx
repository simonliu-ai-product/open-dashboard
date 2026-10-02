import { useEffect, useState } from 'react'
import { driverFor } from '../../datasource/registry.js'
import type { DashboardSummary } from '../../ops/dashboards.js'
import type { SourceStatus } from '../../ops/sources.js'
import { useT } from '../../runtime/i18n.js'
import { CheckIcon, CopyIcon } from '../components/icons.js'
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

function CommandButton({ command, text }: { command: string; text: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <li>
      <button
        type="button"
        className="odd-command"
        onClick={() => {
          navigator.clipboard?.writeText(`${command} `).then(
            () => setCopied(true),
            () => {},
          )
        }}
      >
        <span className="odd-command-head">
          <code>{command}</code>
          <span className="odd-command-copy" aria-live="polite" data-copied={copied || undefined}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? t('Copied') : t('Copy')}
          </span>
        </span>
        <span className="odd-command-text">{t(text)}</span>
      </button>
    </li>
  )
}

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
        <p>
          {t(
            'Ask your coding agent for the dashboard you want. It writes the queries and panels; this page follows along.',
          )}
        </p>
      </header>

      {error ? <p className="odd-callout odd-callout-error">{error}</p> : null}

      <div className="odd-home-grid">
        <section aria-label={t('Dashboards')}>
          {dashboards && dashboards.length === 0 ? (
            <div className="odd-empty">
              <h2>{t('No dashboards yet')}</h2>
              <p>
                {t(
                  'Ask your agent for one with /create-dashboard. It lands in dashboards/<id>/ and shows up here while it is being written.',
                )}
              </p>
            </div>
          ) : (
            <ul className="odd-boards">
              {dashboards?.map((d) => (
                <DashboardRow key={d.id} dashboard={d} />
              ))}
            </ul>
          )}
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
                <CommandButton key={c.command} {...c} />
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
