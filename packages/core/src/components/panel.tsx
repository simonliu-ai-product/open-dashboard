import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useHost } from '../runtime/context.js'
import type { FormatContext } from '../runtime/format.js'
import type { QueryRun } from '../runtime/types.js'
import { type QueryState, useQuery } from '../runtime/use-query.js'
import { useRow } from './layout.js'

export interface PanelProps {
  title: string
  description?: string
  /** Columns out of 12. Default: the row split evenly. */
  span?: number
  /** Height in px. Default: the row's height, else one that suits the panel. */
  height?: number
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

export function useFormatContext(): FormatContext {
  const { meta } = useHost()
  return { locale: meta.locale ?? 'en-US', currency: meta.currency ?? 'USD' }
}

export function usePanelQuery(name: string | undefined): QueryState {
  return useQuery(name)
}

export function PanelFrame(props: FrameProps) {
  const host = useHost()
  const row = useRow()
  const span = Math.min(12, Math.max(1, props.span ?? row.span))
  const height = props.height ?? row.height ?? props.defaultHeight
  const { state } = props
  const run = state.run

  let body: ReactNode
  if (state.status === 'error') {
    body = (
      <div className="odd-panel-message odd-panel-error" role="alert">
        <strong>{props.query ? `Query “${props.query}” failed` : 'This panel failed'}</strong>
        <code>{state.error}</code>
      </div>
    )
  } else if (state.status === 'loading' || !run) {
    body = props.query ? (
      <div className="odd-panel-skeleton" role="status" aria-label="Loading" />
    ) : (
      props.children(undefined as never)
    )
  } else if (run.result.rows.length === 0) {
    body = <div className="odd-panel-message">No rows for these filters</div>
  } else {
    body = props.children(run)
  }

  return (
    <article
      className={`odd-panel odd-panel-${props.component.toLowerCase()}`}
      style={
        { '--odd-span': span, height: height === 'auto' ? undefined : height } as CSSProperties
      }
      data-refreshing={state.refreshing || undefined}
    >
      <header className="odd-panel-head">
        <div className="odd-panel-titles">
          <h3>{props.title}</h3>
          {props.description ? <p>{props.description}</p> : null}
        </div>
        {run && props.aside ? <div className="odd-panel-aside">{props.aside(run)}</div> : null}
        <div className="odd-panel-actions">
          <button
            type="button"
            className="odd-icon-button"
            title="Inspect query and data"
            aria-label={`Inspect ${props.title}`}
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
        </div>
      </header>
      <div className="odd-panel-body">{body}</div>
      {state.refreshing ? <div className="odd-panel-progress" aria-hidden="true" /> : null}
    </article>
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
