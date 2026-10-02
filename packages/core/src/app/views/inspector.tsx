import { useEffect, useState } from 'react'
import type { ParamValue } from '../../config.js'
import type { PanelInfo, QueryRun } from '../../runtime/types.js'
import { api } from '../lib/api.js'

type Tab = 'data' | 'sql' | 'params'

export function Inspector(props: {
  id: string
  panel: PanelInfo
  initial: QueryRun | undefined
  params: Record<string, ParamValue>
  onClose: () => void
  onNote: () => void
}) {
  const { id, panel, initial, params, onClose, onNote } = props
  const [run, setRun] = useState(initial)
  const [error, setError] = useState<string>()
  const [tab, setTab] = useState<Tab>('data')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState<string>()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRun(initial)
    setSaved(undefined)
    if (!initial && panel.query) {
      api.query(id, panel.query, params).then(setRun, (e: Error) => setError(e.message))
    }
  }, [id, panel, initial, params])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (!note.trim()) return
    setSaving(true)
    try {
      const where = await api.comment(id, panel.title, note)
      setSaved(
        `Saved beside the panel in ${where.file}:${where.line}. Ask your agent to /apply-comments.`,
      )
      setNote('')
      onNote()
    } catch (e) {
      setSaved(`Could not save: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const columns = run?.result.columns ?? []
  const rows = run?.result.rows ?? []

  return (
    <aside className="odd-inspector" aria-label={`Inspect ${panel.title}`}>
      <header className="odd-inspector-head">
        <div>
          <span className="odd-muted">{panel.component}</span>
          <h2>{panel.title}</h2>
        </div>
        <button
          type="button"
          className="odd-icon-button"
          onClick={onClose}
          aria-label="Close inspector"
        >
          ✕
        </button>
      </header>

      {run ? (
        <dl className="odd-facts">
          <div>
            <dt>Query</dt>
            <dd>
              <code>{run.query.name}</code>
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{run.query.source}</dd>
          </div>
          <div>
            <dt>Rows</dt>
            <dd>
              {rows.length.toLocaleString()}
              {run.result.truncated ? ' (truncated)' : ''}
            </dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{run.result.elapsedMs.toFixed(1)} ms</dd>
          </div>
          <div className="odd-facts-wide">
            <dt>Defined in</dt>
            <dd>
              <code>
                {run.query.file}:{run.query.line}
              </code>
            </dd>
          </div>
        </dl>
      ) : error ? (
        <p className="odd-callout odd-callout-error">{error}</p>
      ) : panel.query ? (
        <p className="odd-muted">Running…</p>
      ) : (
        <p className="odd-muted">This panel has no query.</p>
      )}

      {run ? (
        <>
          <div className="odd-tabs odd-tabs-small" role="tablist">
            {(['data', 'sql', 'params'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t === 'data' ? 'Data' : t === 'sql' ? 'SQL' : 'Params'}
              </button>
            ))}
          </div>
          <div className="odd-inspector-body">
            {tab === 'data' ? (
              <div className="odd-table-wrap">
                <table className="odd-table odd-table-dense">
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c.name}>
                          {c.name}
                          <span className="odd-col-type">{c.type}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((row, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c.name} data-numeric={c.type === 'number' || undefined}>
                            {row[c.name] === null ? (
                              <span className="odd-muted">null</span>
                            ) : (
                              String(row[c.name])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : tab === 'sql' ? (
              <pre className="odd-code">{run.query.sql}</pre>
            ) : (
              <pre className="odd-code">{JSON.stringify(run.params, null, 2)}</pre>
            )}
          </div>
        </>
      ) : null}

      <form
        className="odd-note"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label htmlFor="odd-note">Note for your agent</label>
        <textarea
          id="odd-note"
          rows={3}
          value={note}
          placeholder="e.g. show this per week instead, and split by channel"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <div className="odd-note-actions">
          {saved ? (
            <span className="odd-muted">{saved}</span>
          ) : (
            <span className="odd-muted">Written into the source as @dashboard-comment</span>
          )}
          <button
            type="submit"
            className="odd-button odd-button-primary"
            disabled={saving || !note.trim()}
          >
            Leave note
          </button>
        </div>
      </form>
    </aside>
  )
}
