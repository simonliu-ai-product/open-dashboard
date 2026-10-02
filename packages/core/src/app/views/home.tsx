import { useEffect, useState } from 'react'
import type { DashboardSummary } from '../../ops/dashboards.js'
import type { SourceStatus } from '../../ops/sources.js'
import { api } from '../lib/api.js'
import { linkProps } from '../lib/router.js'

const PROMPTS = [
  '/connect-database — point this workspace at your Postgres, MySQL, or SQLite database',
  '/create-dashboard — “a sales overview: revenue by month, top 10 products, orders by region”',
  '/apply-comments — apply the notes you left on panels with the inspector',
]

export function HomeView({
  dashboards,
  error,
}: {
  dashboards: DashboardSummary[] | undefined
  error: string | undefined
}) {
  const [sources, setSources] = useState<SourceStatus[]>()
  useEffect(() => {
    api.sources().then(setSources, () => setSources([]))
  }, [])

  return (
    <div className="odd-page">
      <header className="odd-page-head">
        <h1>Dashboards</h1>
        <p>
          Describe the dashboard you want to your coding agent. It writes SQL and panels here; this
          page updates as it does.
        </p>
      </header>

      {error ? <p className="odd-callout odd-callout-error">{error}</p> : null}

      <section className="odd-cards" aria-label="Dashboards">
        {dashboards?.map((d) => (
          <a key={d.id} className="odd-card" {...linkProps(`/d/${encodeURIComponent(d.id)}`)}>
            <h2>{d.title}</h2>
            {d.description ? <p>{d.description}</p> : null}
            <span className="odd-card-meta">
              {d.queries} quer{d.queries === 1 ? 'y' : 'ies'} · {d.file}
            </span>
          </a>
        ))}
        {dashboards && dashboards.length === 0 ? (
          <div className="odd-card odd-card-empty">
            <h2>No dashboards yet</h2>
            <p>
              Ask your agent for one. It lands in <code>dashboards/&lt;id&gt;/</code> and shows up
              here.
            </p>
          </div>
        ) : null}
      </section>

      <div className="odd-split">
        <section className="odd-block">
          <h2>Data sources</h2>
          {sources === undefined ? <p className="odd-muted">Checking connections…</p> : null}
          {sources?.length === 0 ? (
            <p className="odd-muted">
              None configured. Add one to <code>open-dashboard.config.ts</code>, or ask your agent:{' '}
              <code>/connect-database</code>.
            </p>
          ) : null}
          <ul className="odd-source-list">
            {sources?.map((s) => (
              <li key={s.name}>
                <span className="odd-status" data-ok={s.ok} title={s.ok ? 'Connected' : 'Failed'}>
                  {s.ok ? '●' : '▲'}
                </span>
                <a {...linkProps(`/data/${encodeURIComponent(s.name)}`)}>{s.name}</a>
                <span className="odd-muted">
                  {s.type}
                  {s.default ? ' · default' : ''}
                </span>
                <span className="odd-source-detail">{s.ok ? `${s.tables} tables` : s.error}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="odd-block">
          <h2>Ask your agent</h2>
          <ul className="odd-prompts">
            {PROMPTS.map((p) => (
              <li key={p}>
                <code>{p.split(' — ')[0]}</code>
                <span>{p.split(' — ')[1]}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
