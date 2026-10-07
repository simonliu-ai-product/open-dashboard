import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { useHost } from '../runtime/context.js'
import { isPanelType } from '../runtime/convert.js'
import { useEdit } from '../runtime/edit.js'
import { downloadPanel, exportName, type ImageFormat } from '../runtime/export-panel.js'
import type { FormatContext } from '../runtime/format.js'
import { useLocale, useT } from '../runtime/i18n.js'
import type { QueryRun } from '../runtime/types.js'
import { type QueryState, useQuery } from '../runtime/use-query.js'
import type { Drill } from './drill.js'
import { useEditChrome } from './edit-chrome.js'
import { useRow } from './layout.js'

export interface PanelProps {
  title: string
  description?: string
  /** Columns out of 12. Default: the row split evenly. */
  span?: number
  /** Height in px. Default: the row's height, else one that suits the panel. */
  height?: number
  /** Click a mark to filter by it: a `<Select>` name, or `{ filter, column?, dashboard? }`. */
  drill?: Drill
}

interface FrameProps extends PanelProps {
  component: string
  query?: string
  state: QueryState
  defaultHeight: number | 'auto'
  children: (run: QueryRun) => ReactNode
  /** Rendered beside the title — a legend, a total. */
  aside?: (run: QueryRun) => ReactNode
}

/** A dashboard's own `meta.locale` wins; without one, numbers follow the viewer's language. */
export function useFormatContext(): FormatContext {
  const { meta } = useHost()
  const { locale } = useLocale()
  return {
    locale: meta.locale ?? (locale === 'en' ? 'en-US' : locale),
    currency: meta.currency ?? 'USD',
  }
}

export function usePanelQuery(name: string | undefined): QueryState {
  return useQuery(name)
}

export function PanelFrame(props: FrameProps) {
  const host = useHost()
  const edit = useEdit()
  const t = useT()
  const row = useRow()
  const ref = useRef<HTMLElement>(null)
  const chrome = useEditChrome(
    ref,
    props.title,
    Math.min(12, Math.max(1, props.span ?? row.span)),
    props.height ?? row.height ?? props.defaultHeight,
    row.rowIndex,
  )
  const { span, height } = chrome
  const { state } = props
  const run = state.run

  let body: ReactNode
  if (state.status === 'error') {
    body = (
      <div className="odd-panel-message odd-panel-error" role="alert">
        <strong>
          {props.query
            ? t('Query “{query}” failed', { query: props.query })
            : t('This panel failed')}
        </strong>
        <code>{state.error}</code>
      </div>
    )
  } else if (state.status === 'loading' || !run) {
    body = props.query ? (
      <div className="odd-panel-skeleton" role="status" aria-label={t('Loading…')} />
    ) : (
      props.children(undefined as never)
    )
  } else if (run.result.rows.length === 0) {
    body = <div className="odd-panel-message">{t('No rows for these filters')}</div>
  } else {
    body = props.children(run)
  }

  return (
    <article
      ref={ref}
      className={`odd-panel odd-panel-${props.component.toLowerCase()}`}
      style={
        {
          '--odd-span': span,
          height: height === 'auto' ? undefined : height,
          order: chrome.order,
        } as CSSProperties
      }
      data-refreshing={state.refreshing || undefined}
      data-panel-title={props.title}
      data-sized={height === 'auto' ? undefined : ''}
      data-editing={chrome.enabled || undefined}
      data-dragging={chrome.dragging || undefined}
      data-resizing={chrome.resizing || undefined}
    >
      <header className="odd-panel-head">
        {chrome.grip}
        <div className="odd-panel-titles">
          <h3>{props.title}</h3>
          {props.description ? <p>{props.description}</p> : null}
        </div>
        {run && props.aside ? <div className="odd-panel-aside">{props.aside(run)}</div> : null}
        <div className="odd-panel-actions">
          {chrome.enabled && (isPanelType(props.component) || props.component === 'Text') ? (
            <button
              type="button"
              className="odd-icon-button"
              title={t('Change chart')}
              aria-label={t('Change chart for {title}', { title: props.title })}
              onClick={() => edit.configure(props.title)}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M3 13V8M8 13V3M13 13v-7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>
          ) : null}
          <DownloadMenu
            save={async (format) => {
              if (ref.current && format !== 'html')
                await downloadPanel(
                  ref.current,
                  format,
                  exportName(host.id, props.title),
                  props.title,
                )
            }}
            label={t('Download {title}', { title: props.title })}
            disabled={
              props.query
                ? state.status !== 'ok' || !run || run.result.rows.length === 0
                : state.status === 'error'
            }
          />
          {host.inspectable === false ? null : (
            <button
              type="button"
              className="odd-icon-button"
              title={t('Inspect query and data')}
              aria-label={t('Inspect {title}', { title: props.title })}
              onClick={() =>
                host.inspect(
                  { title: props.title, component: props.component, query: props.query },
                  run,
                )
              }
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M2 4h12M2 8h12M2 12h7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            </button>
          )}
        </div>
      </header>
      <div className="odd-panel-body">{body}</div>
      {state.refreshing ? <div className="odd-panel-progress" aria-hidden="true" /> : null}
      {chrome.handles}
    </article>
  )
}

const IMAGE_FORMATS: ImageFormat[] = ['png', 'svg', 'pdf']

/** A download button with a PNG / SVG / PDF menu: a panel's, or the whole dashboard's in its header. */
export function DownloadMenu(props: {
  save: (format: ImageFormat) => Promise<void>
  /** Default PNG, SVG and PDF; the dashboard's adds HTML. */
  formats?: ImageFormat[]
  /** The button's accessible name. */
  label: string
  disabled?: boolean
  className?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(undefined), 6000)
    return () => window.clearTimeout(timer)
  }, [error])

  const save = async (format: ImageFormat) => {
    setOpen(false)
    setError(undefined)
    setBusy(true)
    try {
      await props.save(format)
    } catch (failure) {
      // Said where it was asked for: a download that silently never comes looks like a dead button.
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="odd-download" ref={root} data-export-skip="">
      <button
        ref={trigger}
        type="button"
        className={props.className ?? 'odd-icon-button'}
        title={t('Download')}
        aria-label={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={props.disabled || busy}
        data-busy={busy || undefined}
        onClick={() => {
          setError(undefined)
          setOpen((value) => !value)
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M8 2.5v7.5M4.5 6.8 8 10.3l3.5-3.5M3 13h10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
      {open ? (
        <div className="odd-download-menu" id={id} role="menu">
          {(props.formats ?? IMAGE_FORMATS).map((format) => (
            <button key={format} type="button" role="menuitem" onClick={() => save(format)}>
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}
      {error && !open ? (
        <p className="odd-download-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Tracks an element's content box, for charts that draw to exact pixels. */
export function useSize<T extends HTMLElement>(): [
  RefObject<T | null>,
  { width: number; height: number },
] {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((previous) =>
        Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
          ? previous
          : { width: Math.floor(width), height: Math.floor(height) },
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}
