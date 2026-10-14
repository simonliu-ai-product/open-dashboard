import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceChanges } from '../../ops/changes.js'
import { useT } from '../../runtime/i18n.js'
import { api } from '../lib/api.js'

export function ChangesView() {
  const t = useT()
  const [state, setState] = useState<WorkspaceChanges>()
  const [error, setError] = useState<string>()
  const [reverting, setReverting] = useState<string>()

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

  return (
    <div className="odd-page odd-changes-page">
      <header className="odd-page-header">
        <div>
          <h1>{t('Changes')}</h1>
          <p className="odd-muted">
            {t('Uncommitted changes across dashboards, shared queries, charts and themes.')}
          </p>
        </div>
        <div className="odd-changes-meta">
          {state?.branch ? <code className="odd-branch-pill">⎇ {state.branch}</code> : null}
          <button type="button" className="odd-chip-btn" onClick={load}>
            ↻ {t('Refresh')}
          </button>
        </div>
      </header>

      {error ? (
        <div className="odd-callout odd-callout-error" role="alert">
          {error}
        </div>
      ) : null}

      {!state ? (
        <p className="odd-muted">{t('Loading…')}</p>
      ) : !state.available ? (
        <div className="odd-empty-state">
          <p>{t('This workspace is not in a git repository.')}</p>
        </div>
      ) : state.files.length === 0 ? (
        <div className="odd-empty-state">
          <p>{t('Working tree clean — no uncommitted changes in dashboards or queries.')}</p>
        </div>
      ) : (
        <div className="odd-changes-list">
          {state.files.map((file) => (
            <section key={file.path} className="odd-change-card">
              <header className="odd-change-card-head">
                <div className="odd-change-file-meta">
                  <span className="odd-change-status" data-status={file.status}>
                    {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
                  </span>
                  <code className="odd-change-path">{file.path}</code>
                  <span className="odd-change-counts">
                    {file.additions > 0 ? (
                      <span className="odd-change-add">+{file.additions}</span>
                    ) : null}
                    {file.deletions > 0 ? (
                      <span className="odd-change-del">−{file.deletions}</span>
                    ) : null}
                  </span>
                </div>
                <button
                  type="button"
                  className="odd-chip-btn odd-revert-btn"
                  disabled={reverting === file.path}
                  onClick={() => handleRevert(file.path)}
                >
                  {reverting === file.path ? t('Reverting…') : t('Revert file')}
                </button>
              </header>
              {file.diff ? (
                <pre className="odd-code odd-diff odd-change-diff">
                  {file.diff.split('\n').map((line, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity but their index
                      key={i}
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
                      {line}
                      {'\n'}
                    </span>
                  ))}
                </pre>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
