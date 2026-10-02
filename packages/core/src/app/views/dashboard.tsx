import { dashboards } from 'virtual:open-dashboard/manifest'
import {
  Component,
  createElement,
  type ErrorInfo,
  isValidElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ParamValue } from '../../config.js'
import { HostContext, type HostContextValue } from '../../runtime/context.js'
import { applyProps } from '../../runtime/convert.js'
import { EditContext } from '../../runtime/edit.js'
import { useT } from '../../runtime/i18n.js'
import type { DashboardMeta, PanelInfo, QueryRun } from '../../runtime/types.js'
import { DashboardHeader } from '../components/dashboard-header.js'
import { SaveBar } from '../components/save-bar.js'
import { api } from '../lib/api.js'
import { parseInterval, REFRESH_OPTIONS, readRefresh, writeRefresh } from '../lib/refresh.js'
import { useLayoutEdit } from '../lib/use-layout-edit.js'
import { Inspector, type InspectorTab } from './inspector.js'

interface Loaded {
  view: ReactNode
  meta: DashboardMeta
}

class Boundary extends Component<
  { children: ReactNode; resetKey: unknown; title: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidUpdate(previous: { resetKey: unknown }) {
    if (previous.resetKey !== this.props.resetKey && this.state.error)
      this.setState({ error: null })
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[open-dashboard]', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="odd-callout odd-callout-error" role="alert">
          <strong>{this.props.title}</strong>
          <pre>{this.state.error.message}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

function useDashboardModule(id: string): { loaded?: Loaded; error?: string } {
  const t = useT()
  const [state, setState] = useState<{ loaded?: Loaded; error?: string }>({})
  useEffect(() => {
    const entry = dashboards.find((d) => d.id === id)
    if (!entry) {
      setState({
        error: t('No dashboard "{id}". It should live at dashboards/{id}/index.tsx.', { id }),
      })
      return
    }
    let live = true
    entry.load().then(
      (module) => {
        if (!live) return
        const exported = module.default
        const view = isValidElement(exported)
          ? exported
          : typeof exported === 'function'
            ? createElement(exported as () => ReactNode)
            : null
        if (!view) {
          setState({
            error: t(
              'dashboards/{id}/index.tsx must default-export a component or a <Dashboard> element.',
              {
                id,
              },
            ),
          })
          return
        }
        setState({ loaded: { view, meta: { ...module.meta, title: module.meta?.title ?? id } } })
      },
      (error: Error) => live && setState({ error: error.message }),
    )
    return () => {
      live = false
    }
  }, [id, t])
  return state
}

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function DashboardView({ id }: { id: string }) {
  const t = useT()
  const { loaded, error } = useDashboardModule(id)
  const [tick, setTick] = useState(0)
  const [updatedAt, setUpdatedAt] = useState(() => new Date())
  const [inspecting, setInspecting] = useState<{
    panel: PanelInfo
    run: QueryRun | undefined
    tab?: InspectorTab
  }>()
  const configureRef = useRef<(title: string) => void>(() => {})
  const onConfigure = useCallback((title: string) => configureRef.current(title), [])
  const editor = useLayoutEdit(id, onConfigure)
  configureRef.current = (title) => {
    const source = editor.layout?.panels.find((p) => p.title === title)
    if (!source) return
    const staged = editor.editState.panels[title]
    const props = applyProps(source.props, staged?.changes ?? {})
    setInspecting({
      panel: {
        title,
        component: staged?.component ?? source.component,
        ...(typeof props.query === 'string' ? { query: props.query } : {}),
      },
      run: undefined,
      tab: 'chart',
    })
  }

  const { mode, edits, save, undo } = editor
  useEffect(() => {
    if (mode !== 'edit') return
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest(
        'input, textarea, select, [contenteditable]',
      )
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        save()
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'z' &&
        !event.shiftKey &&
        !typing
      ) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, save, undo])

  useEffect(() => {
    if (edits.length === 0) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [edits.length])
  const [notes, setNotes] = useState<{ line: number; text: string }[]>([])
  const params = useRef<Record<string, ParamValue>>({})
  const focus = useRef<{ panel?: string; query?: string }>({})
  const inflight = useRef(new Map<string, Promise<QueryRun>>())
  const meta = loaded?.meta

  const refresh = useCallback(() => {
    inflight.current.clear()
    setTick((t) => t + 1)
    setUpdatedAt(new Date())
  }, [])

  const loadNotes = useCallback(() => {
    api.comments(id).then(setNotes, () => setNotes([]))
  }, [id])

  useEffect(() => {
    loadNotes()
    const onChange = (data: unknown) => {
      const changed = (data as { id?: string } | undefined)?.id
      if (!changed || changed === id) refresh()
    }
    import.meta.hot?.on('odd:queries-changed', onChange)
    import.meta.hot?.on('vite:afterUpdate', loadNotes)
    return () => {
      import.meta.hot?.off?.('odd:queries-changed', onChange)
      import.meta.hot?.off?.('vite:afterUpdate', loadNotes)
    }
  }, [id, refresh, loadNotes])

  const [refreshSetting, setRefreshSetting] = useState<string>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read only when a different dashboard's default arrives
  useEffect(() => {
    if (meta) setRefreshSetting(readRefresh(meta.refresh))
  }, [meta?.refresh, id])
  const chooseRefresh = (value: string) => {
    setRefreshSetting(value)
    writeRefresh(value, meta?.refresh)
  }
  const refreshChoices = [...REFRESH_OPTIONS] as string[]
  if (refreshSetting && !refreshChoices.includes(refreshSetting))
    refreshChoices.push(refreshSetting)

  const interval = parseInterval(refreshSetting === 'off' ? undefined : refreshSetting)
  useEffect(() => {
    if (!interval) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, interval)
    return () => window.clearInterval(timer)
  }, [interval, refresh])

  useEffect(() => {
    if (meta) document.title = `${meta.title} · open-dashboard`
  }, [meta])

  const host: HostContextValue | undefined = useMemo(() => {
    if (!meta) return undefined
    return {
      id,
      meta,
      tick,
      refresh,
      inspect: (panel, run) => {
        setInspecting({ panel, run })
        focus.current = { panel: panel.title, ...(panel.query ? { query: panel.query } : {}) }
        api.current({
          id,
          title: meta.title,
          ...focus.current,
          params: params.current,
          url: window.location.href,
        })
      },
      onParams: (next) => {
        params.current = next
        api.current({
          id,
          title: meta.title,
          ...focus.current,
          params: next,
          url: window.location.href,
        })
      },
      fetchQuery: (name, values) => {
        const key = `${tick}|${name}|${JSON.stringify(values)}`
        let pending = inflight.current.get(key)
        if (!pending) {
          pending = api.query(id, name, values)
          inflight.current.set(key, pending)
          // Results are kept until the next refresh: a panel re-mounted by a
          // move into another row reads them again instead of re-querying.
          pending.catch(() => inflight.current.delete(key))
        }
        return pending
      },
    }
  }, [id, meta, tick, refresh])

  if (error) {
    return (
      <div className="odd-page">
        <p className="odd-callout odd-callout-error">{error}</p>
      </div>
    )
  }
  if (!loaded || !host) return <div className="odd-page odd-muted">{t('Loading…')}</div>

  return (
    <HostContext.Provider value={host}>
      <EditContext.Provider value={editor.editState}>
        <DashboardHeader
          title={meta?.title ?? id}
          updatedAt={timeOf(updatedAt)}
          refreshSetting={refreshSetting ?? 'off'}
          refreshChoices={refreshChoices}
          onRefreshSetting={chooseRefresh}
          onRefresh={refresh}
          notes={notes}
          mode={mode}
          onMode={editor.setMode}
        />
        <div className="odd-dashboard-page" data-editing={editor.editState.editing || undefined}>
          <Boundary resetKey={loaded} title={t('This dashboard failed to render')}>
            {loaded.view}
          </Boundary>
        </div>
        {mode === 'edit' ? (
          <SaveBar
            file={editor.layout?.file}
            count={edits.length}
            status={editor.status}
            onUndo={undo}
            onDiscard={editor.discard}
            onSave={save}
            onReload={editor.reload}
          />
        ) : null}
        {inspecting ? (
          <Inspector
            id={id}
            panel={inspecting.panel}
            initial={inspecting.run}
            params={params.current}
            onClose={() => setInspecting(undefined)}
            onNote={loadNotes}
            {...(inspecting.tab ? { tab: inspecting.tab } : {})}
          />
        ) : null}
      </EditContext.Provider>
    </HostContext.Provider>
  )
}
