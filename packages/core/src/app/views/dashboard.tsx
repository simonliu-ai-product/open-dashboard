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
import { downloadBlob, downloadDashboard, exportName } from '../../runtime/export-panel.js'
import { useT } from '../../runtime/i18n.js'
import { snapshot } from '../../runtime/snapshot.js'
import type { DashboardTheme } from '../../runtime/theme.js'
import type { DashboardMeta, PanelInfo, QueryRun } from '../../runtime/types.js'
import { Assistant, useAssistantEnabled } from '../components/assistant.js'
import { DashboardHeader } from '../components/dashboard-header.js'
import { SaveBar } from '../components/save-bar.js'
import { api } from '../lib/api.js'
import { parseInterval, REFRESH_OPTIONS, readRefresh, writeRefresh } from '../lib/refresh.js'
import { ThemeStyle, useThemeFile, useThemeList } from '../lib/themes.js'
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

/**
 * `meta.theme` as the file has it now. The module's `meta` is read once and a
 * saved theme change does not swap it, so the source is asked again after a
 * save (`version`: the file's hash) and after a hot update (an agent's edit).
 */
function useSavedTheme(id: string, version: string | undefined): { theme?: string } | undefined {
  const [saved, setSaved] = useState<{ theme?: string }>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-reads the file after a save
  useEffect(() => {
    let live = true
    const load = () =>
      api.dashboards().then(
        (list) => {
          const found = list.find((d) => d.id === id)
          if (live && found) setSaved(found.theme ? { theme: found.theme } : {})
        },
        () => {},
      )
    load()
    import.meta.hot?.on('vite:afterUpdate', load)
    return () => {
      live = false
      import.meta.hot?.off?.('vite:afterUpdate', load)
    }
  }, [id, version])
  return saved
}

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export interface ThemePreview {
  id: string
  theme: DashboardTheme
}

/** `preview` renders the dashboard alone, under a draft theme, for the theme editor. */
export function DashboardView({ id, preview }: { id: string; preview?: ThemePreview }) {
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
  const page = useRef<HTMLDivElement>(null)
  const focus = useRef<{ panel?: string; query?: string }>({})
  const inflight = useRef(new Map<string, Promise<QueryRun>>())
  const meta = loaded?.meta
  const themes = useThemeList()
  const assistant = useAssistantEnabled()
  const staged = editor.edits.findLast((edit) => edit.kind === 'meta' && edit.key === 'theme')
  const saved = useSavedTheme(id, editor.status.kind === 'saved' ? editor.layout?.hash : undefined)
  const chosen = staged?.kind === 'meta' ? staged.value : saved ? saved.theme : meta?.theme
  const themeId = chosen ?? themes?.default
  const file = useThemeFile(preview ? undefined : themeId).file
  const theme = preview ?? (file ? { id: file.id, theme: file.theme } : undefined)

  // The tick a reader asked for with the refresh button: it skips the server's
  // cache. Auto-refresh and live reload may be served from it.
  const freshTick = useRef(-1)
  const refresh = useCallback(() => {
    inflight.current.clear()
    setTick((t) => t + 1)
    setUpdatedAt(new Date())
  }, [])
  const refreshNow = useCallback(() => {
    inflight.current.clear()
    setTick((t) => {
      freshTick.current = t + 1
      return t + 1
    })
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

  const taken = snapshot()?.builtAt
  const interval = parseInterval(refreshSetting === 'off' || taken ? undefined : refreshSetting)
  useEffect(() => {
    if (!interval) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, interval)
    return () => window.clearInterval(timer)
  }, [interval, refresh])

  useEffect(() => {
    if (meta && !preview) document.title = `${meta.title} · open-dashboard`
  }, [meta, preview])

  const [filterOverride, setFilterOverride] = useState<HostContextValue['filterOverride']>()
  const applyFilters = useCallback(
    (values: Record<string, string | null>) =>
      setFilterOverride((previous) => ({ values, seq: (previous?.seq ?? 0) + 1 })),
    [],
  )

  const host: HostContextValue | undefined = useMemo(() => {
    if (!meta) return undefined
    return {
      id,
      meta,
      tick,
      refresh,
      inspectable: !preview && !taken,
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
      ...(filterOverride ? { filterOverride } : {}),
      fetchQuery: (name, values) => {
        const key = `${tick}|${name}|${JSON.stringify(values)}`
        let pending = inflight.current.get(key)
        if (!pending) {
          pending = api.query(id, name, values, tick === freshTick.current)
          inflight.current.set(key, pending)
          // Results are kept until the next refresh: a panel re-mounted by a
          // move into another row reads them again instead of re-querying.
          pending.catch(() => inflight.current.delete(key))
        }
        return pending
      },
    }
  }, [id, meta, tick, refresh, preview, taken, filterOverride])

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
        {theme ? <ThemeStyle id={theme.id} theme={theme.theme} /> : null}
        <div
          className="odd-themed"
          data-odd-theme={theme?.id}
          data-preview={preview ? '' : undefined}
        >
          {preview ? null : (
            <DashboardHeader
              title={meta?.title ?? id}
              updatedAt={
                taken
                  ? new Date(taken).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : timeOf(updatedAt)
              }
              frozen={taken !== undefined}
              refreshSetting={refreshSetting ?? 'off'}
              refreshChoices={refreshChoices}
              onRefreshSetting={chooseRefresh}
              onRefresh={refreshNow}
              notes={notes}
              mode={mode}
              onMode={editor.setMode}
              themes={themes?.themes}
              theme={chosen ?? ''}
              onTheme={(value) =>
                editor.editState.stage({ kind: 'meta', key: 'theme', value: value || null })
              }
              standalone={snapshot()?.single === true}
              // HTML is built by the server; a snapshot has none.
              formats={taken ? ['png', 'svg', 'pdf'] : ['png', 'svg', 'pdf', 'html']}
              onDownload={async (format) => {
                if (format === 'html') {
                  const blob = await api.exportHtml(id, window.location.search)
                  downloadBlob(blob, `${exportName(id, '')}.html`)
                } else if (page.current) {
                  await downloadDashboard(page.current, format, exportName(id, ''), meta?.title)
                }
              }}
            />
          )}
          <div
            ref={page}
            className="odd-dashboard-page"
            data-editing={editor.editState.editing || undefined}
          >
            <Boundary resetKey={loaded} title={t('This dashboard failed to render')}>
              {loaded.view}
            </Boundary>
          </div>
        </div>
        {mode === 'edit' && !preview && (edits.length > 0 || editor.status.kind !== 'idle') ? (
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
        {assistant && !preview && meta ? (
          <Assistant
            dashboard={id}
            title={meta.title}
            params={() => params.current}
            onFilters={applyFilters}
          />
        ) : null}
        {inspecting && !preview ? (
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
