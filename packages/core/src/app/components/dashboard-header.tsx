import { useEffect, useState } from 'react'
import { DownloadMenu } from '../../components/panel.js'
import type { ImageFormat } from '../../runtime/export-panel.js'
import { useT } from '../../runtime/i18n.js'
import { intervalLabel } from '../lib/refresh.js'
import { linkProps } from '../lib/router.js'
import type { Mode } from '../lib/use-layout-edit.js'
import { CheckIcon, CopyIcon, EyeIcon, LinkIcon, PencilIcon, RefreshIcon } from './icons.js'

export interface DashboardHeaderProps {
  title: string
  updatedAt: string
  refreshSetting: string
  refreshChoices: string[]
  onRefreshSetting: (value: string) => void
  onRefresh: () => void
  notes: { line: number; text: string }[]
  mode: Mode
  onMode: (mode: Mode) => void
  /** Shown in edit mode: the themes to pick from, and `meta.theme` as staged ('' for the workspace default). */
  themes?: { id: string; name: string }[]
  theme?: string
  onTheme?: (id: string) => void
  /** The whole dashboard as one image. */
  onDownload?: (format: ImageFormat) => Promise<void>
}

/**
 * The bar across the top of a dashboard, as in open-doc and open-slide: where
 * you are on the left, what you can do on the right — with Preview / Edit last,
 * so changing the layout is always a deliberate switch.
 */
export function DashboardHeader(props: DashboardHeaderProps) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const [notesCopied, setNotesCopied] = useState(false)
  useEffect(() => {
    if (!copied && !notesCopied) return
    const timer = window.setTimeout(() => {
      setCopied(false)
      setNotesCopied(false)
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [copied, notesCopied])

  return (
    <header className="odd-header" data-mode={props.mode}>
      <nav className="odd-crumbs" aria-label={t('Breadcrumb')}>
        <a {...linkProps('/')}>{t('Dashboards')}</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{props.title}</span>
      </nav>

      <div className="odd-header-actions">
        {props.notes.length > 0 ? (
          <button
            type="button"
            className="odd-notes-pill"
            title={props.notes.map((n) => `${n.line}: ${n.text}`).join('\n')}
            onClick={() =>
              navigator.clipboard?.writeText('/apply-comments ').then(
                () => setNotesCopied(true),
                () => {},
              )
            }
          >
            <span>
              {t(props.notes.length === 1 ? '1 note' : '{n} notes', { n: props.notes.length })}
            </span>
            <code>/apply-comments</code>
            {notesCopied ? <CheckIcon /> : <CopyIcon />}
          </button>
        ) : null}
        <span className="odd-header-updated">{t('Updated {time}', { time: props.updatedAt })}</span>
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
        {props.onDownload ? (
          <DownloadMenu
            save={props.onDownload}
            label={t('Download dashboard')}
            className="odd-icon-button odd-header-icon"
          />
        ) : null}
      </div>
    </header>
  )
}
