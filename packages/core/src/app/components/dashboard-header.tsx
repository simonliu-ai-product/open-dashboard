import { useEffect, useRef, useState } from 'react'
import { DownloadMenu } from '../../components/panel.js'
import type { ImageFormat } from '../../runtime/export-panel.js'
import { useT } from '../../runtime/i18n.js'
import type { DashboardNoteView } from '../lib/api.js'
import { onManageRequest } from '../lib/manage-events.js'
import { intervalLabel } from '../lib/refresh.js'
import { linkProps } from '../lib/router.js'
import type { Mode } from '../lib/use-layout-edit.js'
import {
  CheckIcon,
  CopyIcon,
  EyeIcon,
  LinkIcon,
  MoreIcon,
  PencilIcon,
  RefreshIcon,
} from './icons.js'

export interface DashboardHeaderProps {
  title: string
  updatedAt: string
  refreshSetting: string
  refreshChoices: string[]
  onRefreshSetting: (value: string) => void
  onRefresh: () => void
  notes: DashboardNoteView[]
  /** Removes a note once it is dealt with; the page reloads the list after. */
  onResolveNote?: (note: DashboardNoteView) => Promise<void>
  mode: Mode
  onMode: (mode: Mode) => void
  /** Shown in edit mode: the themes to pick from, and `meta.theme` as staged ('' for the workspace default). */
  themes?: { id: string; name: string }[]
  theme?: string
  onTheme?: (id: string) => void
  /** The whole dashboard as one image. */
  onDownload?: (format: ImageFormat) => Promise<void>
  /** A built snapshot: results are fixed, nothing can be edited or refreshed. */
  frozen?: boolean
  /** A page for readers: no notes, no edit mode. */
  readOnly?: boolean
  /** A one-file export: no list to go back to, no address worth copying. */
  standalone?: boolean
  formats?: ImageFormat[]
  /** Managing the dashboard itself, as open-doc's document menu: given only where files can be written. */
  manage?: {
    rename: (title: string) => Promise<void>
    duplicate: () => Promise<void>
    /** Moves the dashboard to `.open-dashboard/trash/`. */
    remove: () => Promise<void>
  }
}

/** The ⋯ menu: rename (in place, on the title), duplicate, delete with a second click to confirm. */
export function ManageMenu(props: {
  manage: NonNullable<DashboardHeaderProps['manage']>
  onRename: () => void
  /** The header's menu also answers the command palette; a home row's does not. */
  listen?: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  const runRef = useRef<(action: () => Promise<void>) => Promise<void>>(async () => {})
  useEffect(() => {
    if (!props.listen) return
    return onManageRequest((action) => {
      if (action === 'rename') latest.current.onRename()
      else if (action === 'duplicate') void runRef.current(latest.current.manage.duplicate)
      else {
        // Opened at the confirming step: the reader still clicks once to delete.
        setOpen(true)
        setConfirming(true)
      }
    })
  }, [props.listen])
  useEffect(() => {
    if (!open) {
      setConfirming(false)
      return
    }
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const run = async (action: () => Promise<void>) => {
    setError(undefined)
    try {
      await action()
      setOpen(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  runRef.current = run
  return (
    <div className="odd-more" ref={root}>
      <button
        type="button"
        className="odd-icon-button odd-header-icon"
        aria-label={t('Dashboard actions')}
        title={t('Dashboard actions')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="odd-more-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              props.onRename()
            }}
          >
            {t('Rename…')}
          </button>
          <button type="button" role="menuitem" onClick={() => run(props.manage.duplicate)}>
            {t('Duplicate')}
          </button>
          <button
            type="button"
            role="menuitem"
            data-danger=""
            onClick={() => (confirming ? run(props.manage.remove) : setConfirming(true))}
          >
            {confirming ? t('Click again to move to the trash') : t('Delete…')}
          </button>
          {error ? <p className="odd-more-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

/** The page title, which becomes a field while it is being renamed. */
export function TitleField(props: {
  title: string
  editing: boolean
  onDone: (title?: string) => void
  /** A new dashboard: the title is only a suggestion, so Enter keeps it rather than counting as no change. */
  placeholder?: string
}) {
  const t = useT()
  const [value, setValue] = useState(props.title)
  useEffect(() => setValue(props.title), [props.title])
  if (!props.editing) return <span aria-current="page">{props.title}</span>
  const finish = (commit: boolean) => {
    const next = value.trim()
    props.onDone(
      commit && next && (props.placeholder !== undefined || next !== props.title)
        ? next
        : undefined,
    )
  }
  return (
    <input
      className="odd-title-input"
      aria-label={t('Dashboard title')}
      {...(props.placeholder ? { placeholder: props.placeholder } : {})}
      value={value}
      maxLength={200}
      // biome-ignore lint/a11y/noAutofocus: the field appears because the reader chose Rename
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      // Clicking away from a new dashboard's untouched suggestion cancels it rather than creating one.
      onBlur={() => finish(props.placeholder === undefined || value.trim() !== props.title)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true)
        else if (e.key === 'Escape') finish(false)
      }}
    />
  )
}

function loc(): Pick<Location, 'pathname' | 'search' | 'href'> {
  return (window as { __cwLocation?: () => URL }).__cwLocation?.() ?? window.location
}

/**
 * The bar across the top of a dashboard, as in open-doc and open-slide: where
 * you are on the left, what you can do on the right — with Preview / Edit last,
 * so changing the layout is always a deliberate switch.
 */
export function DashboardHeader(props: DashboardHeaderProps) {
  const t = useT()
  const [renaming, setRenaming] = useState(false)
  const [copied, setCopied] = useState(false)
  const [notesCopied, setNotesCopied] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [resolving, setResolving] = useState<number | null>(null)
  const notesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!notesOpen) return
    const onDown = (e: MouseEvent) => {
      if (!notesRef.current?.contains(e.target as Node)) setNotesOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNotesOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [notesOpen])
  useEffect(() => {
    if (props.notes.length === 0) setNotesOpen(false)
  }, [props.notes.length])
  const showPanel = (title: string) => {
    const node = [...document.querySelectorAll<HTMLElement>('[data-panel-title]')].find(
      (n) => n.dataset.panelTitle === title,
    )
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    node.classList.remove('odd-panel-flash')
    void node.offsetWidth
    node.classList.add('odd-panel-flash')
    setNotesOpen(false)
  }
  const [kiosk, setKiosk] = useState(
    () => typeof window !== 'undefined' && new URLSearchParams(loc().search).get('kiosk') === '1',
  )
  useEffect(() => {
    const sync = () => setKiosk(new URLSearchParams(loc().search).get('kiosk') === '1')
    window.addEventListener('odd:kiosk-changed', sync)
    window.addEventListener('popstate', sync)
    return () => {
      window.removeEventListener('odd:kiosk-changed', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])
  useEffect(() => {
    if (kiosk) document.documentElement.dataset.oddKiosk = '1'
    else delete document.documentElement.dataset.oddKiosk
    return () => {
      delete document.documentElement.dataset.oddKiosk
    }
  }, [kiosk])
  useEffect(() => {
    if (!kiosk) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const url = new URL(loc().href)
        url.searchParams.delete('kiosk')
        window.history.replaceState(window.history.state, '', url)
        window.dispatchEvent(new CustomEvent('odd:kiosk-changed'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kiosk])
  useEffect(() => {
    if (!copied && !notesCopied) return
    const timer = window.setTimeout(() => {
      setCopied(false)
      setNotesCopied(false)
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [copied, notesCopied])

  const toggleKiosk = () => {
    const url = new URL(loc().href)
    if (kiosk) url.searchParams.delete('kiosk')
    else url.searchParams.set('kiosk', '1')
    try {
      window.history.replaceState(window.history.state, '', url)
    } catch {
      // ignore on file://
    }
    setKiosk(!kiosk)
    window.dispatchEvent(new CustomEvent('odd:kiosk-changed'))
  }

  return (
    <header className="odd-header" data-mode={props.mode}>
      <nav className="odd-crumbs" aria-label={t('Breadcrumb')}>
        {props.standalone ? null : (
          <>
            <a {...linkProps('/')}>{t('Dashboards')}</a>
            <span aria-hidden="true">/</span>
          </>
        )}
        <TitleField
          title={props.title}
          editing={renaming}
          onDone={(title) => {
            setRenaming(false)
            if (title) void props.manage?.rename(title)
          }}
        />
      </nav>

      <div className="odd-header-actions">
        {props.notes.length > 0 && !props.readOnly ? (
          <div className="odd-notes" ref={notesRef}>
            <button
              type="button"
              className="odd-notes-pill"
              aria-expanded={notesOpen}
              aria-haspopup="dialog"
              onClick={() => setNotesOpen(!notesOpen)}
            >
              <span>
                {t(props.notes.length === 1 ? '1 note' : '{n} notes', { n: props.notes.length })}
              </span>
            </button>
            {notesOpen ? (
              <div className="odd-notes-pop" role="dialog" aria-label={t('Notes for your agent')}>
                <div className="odd-notes-head">
                  <strong>{t('Notes for your agent')}</strong>
                  <button
                    type="button"
                    className="odd-notes-copy"
                    title={t('Copy the command that applies them')}
                    onClick={() =>
                      navigator.clipboard?.writeText('/apply-comments ').then(
                        () => setNotesCopied(true),
                        () => {},
                      )
                    }
                  >
                    <code>/apply-comments</code>
                    {notesCopied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
                <ol className="odd-notes-list">
                  {props.notes.map((note) => (
                    <li key={`${note.line}:${note.text}`}>
                      <span className="odd-notes-where">
                        {note.panel ?? t('Line {n}', { n: note.line })}
                      </span>
                      <p>{note.text}</p>
                      <div className="odd-notes-actions">
                        {note.panel ? (
                          <button type="button" onClick={() => showPanel(note.panel as string)}>
                            {t('Show panel')}
                          </button>
                        ) : null}
                        {props.onResolveNote ? (
                          <button
                            type="button"
                            disabled={resolving === note.line}
                            onClick={() => {
                              setResolving(note.line)
                              props.onResolveNote?.(note).finally(() => setResolving(null))
                            }}
                          >
                            {t('Resolve')}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>
        ) : null}
        <span className="odd-header-updated">{t('Updated {time}', { time: props.updatedAt })}</span>
        {props.frozen ? null : (
          <>
            <label className="odd-refresh">
              <span className="odd-sr-only">{t('Auto-refresh')}</span>
              <select
                value={props.refreshSetting}
                onChange={(event) => props.onRefreshSetting(event.target.value)}
                title={t('Auto-refresh')}
              >
                {props.refreshChoices.map((value) => (
                  <option key={value} value={value}>
                    {value === 'off' ? t('Auto-refresh off') : intervalLabel(value, t)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="odd-icon-button odd-header-icon"
              onClick={props.onRefresh}
              title={t('Refresh')}
              aria-label={t('Refresh')}
            >
              <RefreshIcon />
            </button>
          </>
        )}
        <button
          type="button"
          className="odd-icon-button odd-header-icon"
          title={kiosk ? t('Exit kiosk') : t('Kiosk mode')}
          aria-label={kiosk ? t('Exit kiosk') : t('Kiosk mode')}
          aria-pressed={kiosk}
          onClick={toggleKiosk}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M2.5 5.5V2.5h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>
        {props.standalone ? null : (
          <button
            type="button"
            className="odd-icon-button odd-header-icon"
            title={copied ? t('Link copied') : t('Copy link')}
            aria-label={copied ? t('Link copied') : t('Copy link')}
            onClick={() =>
              navigator.clipboard?.writeText(window.location.href).then(
                () => setCopied(true),
                () => {},
              )
            }
          >
            {copied ? <CheckIcon /> : <LinkIcon />}
          </button>
        )}
        {props.mode === 'edit' && props.themes && props.onTheme ? (
          <label className="odd-refresh">
            <span className="odd-sr-only">{t('Themes')}</span>
            <select
              value={props.theme ?? ''}
              title={t('Themes')}
              onChange={(event) => props.onTheme?.(event.target.value)}
            >
              <option value="">{t('Default')}</option>
              {props.themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {props.readOnly ? null : (
          <fieldset className="odd-mode">
            <legend className="odd-sr-only">{t('Mode')}</legend>
            <button
              type="button"
              aria-pressed={props.mode === 'view'}
              onClick={() => props.onMode('view')}
              title={t('Preview')}
            >
              <EyeIcon />
              <span>{t('Preview')}</span>
            </button>
            <button
              type="button"
              aria-pressed={props.mode === 'edit'}
              onClick={() => props.onMode('edit')}
              title={t('Edit')}
            >
              <PencilIcon />
              <span>{t('Edit')}</span>
            </button>
          </fieldset>
        )}
        {props.onDownload ? (
          <DownloadMenu
            save={props.onDownload}
            {...(props.formats ? { formats: props.formats } : {})}
            label={t('Download dashboard')}
            className="odd-icon-button odd-header-icon"
          />
        ) : null}
        {props.manage && !props.readOnly && !props.frozen && !props.standalone ? (
          <ManageMenu manage={props.manage} onRename={() => setRenaming(true)} listen />
        ) : null}
      </div>
    </header>
  )
}
