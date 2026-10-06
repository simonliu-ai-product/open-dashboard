import { useEffect, useState } from 'react'
import type { ParamValue } from '../../config.js'
import { useEdit } from '../../runtime/edit.js'
import { useT } from '../../runtime/i18n.js'
import type { PanelInfo, QueryRun } from '../../runtime/types.js'
import { ChartSettings } from '../components/chart-settings.js'
import { CheckIcon } from '../components/icons.js'
import { api } from '../lib/api.js'

export type InspectorTab = 'chart' | 'data' | 'sql' | 'params'
type Tab = InspectorTab

const TAB_LABELS: Record<Tab, string> = {
  chart: 'Chart',
  data: 'Data',
  sql: 'SQL',
  params: 'Params',
}

export function Inspector(props: {
  id: string
  panel: PanelInfo
  initial: QueryRun | undefined
  params: Record<string, ParamValue>
  onClose: () => void
  onNote: () => void
  tab?: InspectorTab
}) {
  const { id, panel, initial, params, onClose, onNote } = props
  const t = useT()
  const edit = useEdit()
  const [run, setRun] = useState(initial)
  const [error, setError] = useState<string>()
  const [tab, setTab] = useState<Tab>(props.tab ?? 'data')
  // biome-ignore lint/correctness/useExhaustiveDependencies: a newly inspected panel re-applies the requested tab
  useEffect(() => {
    if (props.tab) setTab(props.tab)
  }, [props.tab, panel])
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState<string>()
  const [failed, setFailed] = useState<string>()
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
      setFailed(undefined)
      setSaved(`${where.file}:${where.line}`)
      setNote('')
      onNote()
    } catch (e) {
      setSaved(undefined)
      setFailed(t('Could not save: {error}', { error: (e as Error).message }))
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
          <span className="odd-muted">
            {edit.panels[panel.title]?.component ?? panel.component}
          </span>
          <h2>{panel.title}</h2>
        </div>
        <button
          type="button"
          className="odd-icon-button"
          onClick={onClose}
          aria-label={t('Close inspector')}
        >
          ✕
        </button>
      </header>

      {run ? (
        <dl className="odd-facts">
          <div>
            <dt>{t('Query')}</dt>
            <dd>
              <code>{run.query.name}</code>
            </dd>
          </div>
          <div>
            <dt>{t('Source')}</dt>
            <dd>{run.query.source}</dd>
          </div>
          <div>
            <dt>{t('Rows')}</dt>
            <dd>
              {rows.length.toLocaleString()}
              {run.result.truncated ? ` ${t('(truncated)')}` : ''}
            </dd>
          </div>
          <div>
            <dt>{t('Time')}</dt>
            <dd>{run.result.elapsedMs.toFixed(1)} ms</dd>
          </div>
          <div className="odd-facts-wide">
            <dt>{t('Defined in')}</dt>
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
        <p className="odd-muted">{t('Running…')}</p>
      ) : (
        <p className="odd-muted">{t('This panel has no query.')}</p>
      )}

      {run ? (
        <>
          <div className="odd-tabs odd-tabs-small" role="tablist">
            {(['chart', 'data', 'sql', 'params'] as Tab[]).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
              >
                {t(TAB_LABELS[name])}
              </button>
            ))}
          </div>
          <div className="odd-inspector-body">
            {tab === 'chart' ? (
              <ChartSettings title={panel.title} columns={run.result.columns} />
            ) : tab === 'data' ? (
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
        <label htmlFor="odd-note">{t('Note for your agent')}</label>
        <textarea
          id="odd-note"
          rows={3}
          value={note}
          placeholder={t('e.g. show this per week instead, and split by channel')}
          aria-describedby={saved ? 'odd-note-saved' : undefined}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <div className="odd-note-actions">
          {saved ? (
            <span className="odd-note-saved" id="odd-note-saved" role="status">
              <CheckIcon />
              <code>{saved}</code>
            </span>
          ) : failed ? (
            <span className="odd-field-error" role="alert">
              {failed}
            </span>
          ) : (
            <span />
          )}
          <button
            type="submit"
            className="odd-button odd-button-primary"
            disabled={saving || !note.trim()}
          >
            {t('Leave note')}
          </button>
        </div>
      </form>
    </aside>
  )
}
