import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceChanges, WorkspaceFileChange } from '../../ops/changes.js'
import { useT } from '../../runtime/i18n.js'
import { RefreshIcon } from '../components/icons.js'
import { api } from '../lib/api.js'

function groupLabel(path: string): string {
  if (path.startsWith('dashboards/')) return 'Dashboards'
  if (path.startsWith('charts/')) return 'Charts'
  if (path.startsWith('themes/')) return 'Themes'
  return 'Files'
}

function shortLabel(path: string): string {
  const parts = path.split('/')
  if (parts.length >= 3 && (parts[0] === 'dashboards' || parts[0] === 'charts')) {
    return parts.slice(1).join('/')
  }
  return parts[parts.length - 1] || path
}

function statusLetter(status: WorkspaceFileChange['status']): string {
  return status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M'
}

export function ChangesView() {
  const t = useT()
  const [state, setState] = useState<WorkspaceChanges>()
  const [error, setError] = useState<string>()
  const [reverting, setReverting] = useState<string>()
  const [selectedPath, setSelectedPath] = useState<string>()
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    api.changes().then(
      (res) => {
        setState(res)
        setError(undefined)
      },
      (e: Error) => setError(e.message),
    )
  }, [])

  useEffect(() => {
    load()
    const reload = () => load()
    import.meta.hot?.on('odd:queries-changed', reload)
    return () => import.meta.hot?.off?.('odd:queries-changed', reload)
  }, [load])

  const handleRevert = async (path: string) => {
    setReverting(path)
    setError(undefined)
    try {
      await api.revertChange(path)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setReverting(undefined)
    }
  }

  const needle = query.trim().toLowerCase()
  const shown = useMemo(
    () => state?.files.filter((file) => !needle || file.path.toLowerCase().includes(needle)) ?? [],
    [state?.files, needle],
  )

  const selected =
    shown.find((file) => file.path === selectedPath) ??
    state?.files.find((file) => file.path === selectedPath) ??
    shown[0] ??
    state?.files[0]

  const groups = useMemo(() => {
    const order = ['Dashboards', 'Charts', 'Themes', 'Files']
    return order
      .map((label) => ({
        label,
        items: shown.filter((file) => groupLabel(file.path) === label),
      }))
      .filter((group) => group.items.length > 0)
  }, [shown])

  const hasFiles = Boolean(state?.available && state.files.length > 0)

  return (
    <div
      className={`odd-page odd-studio-page odd-changes-page${hasFiles ? ' odd-charts-page' : ''}`}
    >
      <header className="odd-studio-head">
        <div className="odd-studio-title">
          <h1>{t('Changes')}</h1>
          {state?.branch ? (
            <span className="odd-badge odd-branch-pill">⎇ {state.branch}</span>
          ) : null}
          {hasFiles ? (
            <span className="odd-badge">{t('{n} files', { n: state?.files.length ?? 0 })}</span>
          ) : null}
        </div>
        <div className="odd-studio-actions">
          <button type="button" className="odd-button odd-button-icon" onClick={load}>
            <RefreshIcon />
            <span>{t('Refresh')}</span>
          </button>
        </div>
      </header>

      {error ? (
        <p className="odd-callout odd-callout-error" role="alert">
          {error}
        </p>
      ) : null}

      {!state ? (
        <p className="odd-muted">{t('Loading…')}</p>
      ) : !state.available ? (
        <div className="odd-studio-empty">
          <p>{t('This workspace is not in a git repository.')}</p>
        </div>
      ) : state.files.length === 0 ? (
        <div className="odd-studio-empty">
          <p>{t('Working tree clean — no uncommitted changes in dashboards or queries.')}</p>
          <span className="odd-studio-empty-sub">
            {t('Uncommitted changes across dashboards, shared queries, charts and themes.')}
          </span>
        </div>
      ) : (
        <div className="odd-gallery">
          <nav className="odd-gallery-list" aria-label={t('Files')}>
            <input
              type="search"
              className="odd-gallery-search"
              value={query}
              placeholder={t('Search')}
              aria-label={t('Search')}
              onChange={(event) => setQuery(event.target.value)}
            />
            {groups.map((group) => (
              <div key={group.label} className="odd-gallery-group">
                <h2>{t(group.label)}</h2>
                {group.items.map((file) => (
                  <a
                    key={file.path}
                    href={`#${encodeURIComponent(file.path)}`}
                    aria-current={selected?.path === file.path ? 'page' : undefined}
                    onClick={(event) => {
                      event.preventDefault()
                      setSelectedPath(file.path)
                    }}
                  >
                    <span className="odd-chart-icon odd-change-status" data-status={file.status}>
                      {statusLetter(file.status)}
                    </span>
                    <span className="odd-gallery-name" title={file.path}>
                      {shortLabel(file.path)}
                    </span>
                    {file.additions > 0 || file.deletions > 0 ? (
                      <span className="odd-gallery-count odd-change-counts">
                        {file.additions > 0 ? (
                          <span className="odd-change-add">+{file.additions}</span>
                        ) : null}
                        {file.deletions > 0 ? (
                          <span className="odd-change-del">−{file.deletions}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </a>
                ))}
              </div>
            ))}
          </nav>

          {selected ? (
            <article key={selected.path} className="odd-gallery-detail">
              <header className="odd-gallery-head odd-change-detail-head">
                <span className="odd-chart-icon odd-change-status" data-status={selected.status}>
                  {statusLetter(selected.status)}
                </span>
                <h2>{shortLabel(selected.path)}</h2>
                <code>{selected.path}</code>
                <span className="odd-change-counts">
                  {selected.additions > 0 ? (
                    <span className="odd-change-add">+{selected.additions}</span>
                  ) : null}
                  {selected.deletions > 0 ? (
                    <span className="odd-change-del">−{selected.deletions}</span>
                  ) : null}
                </span>
                <div className="odd-change-actions">
                  <button
                    type="button"
                    className="odd-button"
                    disabled={reverting === selected.path}
                    onClick={() => handleRevert(selected.path)}
                  >
                    {reverting === selected.path ? t('Reverting…') : t('Revert file')}
                  </button>
                </div>
              </header>

              {selected.diff ? (
                <div className="odd-code-block odd-change-diff-wrap">
                  <pre className="odd-code odd-diff odd-change-diff">
                    {selected.diff.split('\n').map((line, i) => (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity but their index
                        key={i}
                        className="odd-diff-line"
                        data-kind={
                          line.startsWith('+')
                            ? 'add'
                            : line.startsWith('-')
                              ? 'del'
                              : line.startsWith('@@')
                                ? 'hunk'
                                : undefined
                        }
                      >
                        {line || ' '}
                      </div>
                    ))}
                  </pre>
                </div>
              ) : null}
            </article>
          ) : null}
        </div>
      )}
    </div>
  )
}
