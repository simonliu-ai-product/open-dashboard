import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardLayout } from '../../ops/layout.js'
import type { LayoutEdit } from '../../runtime/convert.js'
import { type EditState, foldEdits, foldStructure, stageEdit } from '../../runtime/edit.js'
import { snapshot } from '../../runtime/snapshot.js'
import { api } from './api.js'
import { setNavigationGuard } from './router.js'

export type Mode = 'view' | 'edit'

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'blocked' }
  | { kind: 'error'; message: string; stale: boolean }

const MODE_KEY = 'odd:mode'

function initialMode(): Mode {
  if (snapshot()) return 'view'
  try {
    return sessionStorage.getItem(MODE_KEY) === 'edit' ? 'edit' : 'view'
  } catch {
    return 'view'
  }
}

/**
 * Edit mode for one dashboard. Changes are staged and previewed; only Save
 * writes, all at once, against the hash the page read — so a file the agent
 * changed meanwhile is refused instead of overwritten.
 */
export function useLayoutEdit(id: string, onConfigure: (title: string) => void) {
  const [mode, setModeState] = useState<Mode>(initialMode)
  const [layout, setLayout] = useState<DashboardLayout>()
  const [edits, setEdits] = useState<LayoutEdit[]>([])
  const [liveOrder, setLiveOrder] = useState<string[]>()
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })
  const awaitingReload = useRef(false)

  const loadLayout = useCallback(() => {
    api.layout(id).then(
      (next) => setLayout(next),
      (error: Error) => setStatus({ kind: 'error', message: error.message, stale: false }),
    )
  }, [id])

  useEffect(() => {
    if (mode === 'edit') loadLayout()
  }, [mode, loadLayout])

  // After a save, the staged edits stay on screen until the rewritten source
  // has hot-reloaded — clearing them first would flash the old layout.
  useEffect(() => {
    const onUpdate = () => {
      if (awaitingReload.current) {
        awaitingReload.current = false
        setEdits([])
        setStatus({ kind: 'saved' })
      }
      if (mode === 'edit') loadLayout()
    }
    import.meta.hot?.on('vite:afterUpdate', onUpdate)
    return () => import.meta.hot?.off?.('vite:afterUpdate', onUpdate)
  }, [mode, loadLayout])

  const setMode = useCallback(
    (next: Mode) => {
      if (next === 'view' && edits.length > 0) {
        setStatus({ kind: 'blocked' })
        return
      }
      setModeState(next)
      setStatus({ kind: 'idle' })
      try {
        sessionStorage.setItem(MODE_KEY, next)
      } catch {
        // the mode still applies for this page
      }
    },
    [edits.length],
  )

  useEffect(() => {
    if (edits.length === 0) return
    return setNavigationGuard(() => {
      setStatus({ kind: 'blocked' })
      return true
    })
  }, [edits.length])

  const stage = useCallback((edit: LayoutEdit) => {
    setEdits((current) => stageEdit(current, edit))
    setStatus({ kind: 'idle' })
  }, [])

  const undo = useCallback(() => setEdits((current) => current.slice(0, -1)), [])

  const discard = useCallback(() => {
    setEdits([])
    setStatus({ kind: 'idle' })
  }, [])

  const reload = useCallback(() => {
    setEdits([])
    setStatus({ kind: 'idle' })
    loadLayout()
  }, [loadLayout])

  const save = useCallback(async () => {
    if (!layout || edits.length === 0) return
    setStatus({ kind: 'saving' })
    try {
      const result = await api.saveLayout(id, layout.hash, edits)
      setLayout((current) => (current ? { ...current, hash: result.hash } : current))
      awaitingReload.current = true
      window.setTimeout(() => {
        if (!awaitingReload.current) return
        awaitingReload.current = false
        setEdits([])
        setStatus({ kind: 'saved' })
      }, 2500)
    } catch (error) {
      const message = (error as Error).message
      setStatus({ kind: 'error', message, stale: /changed on disk/.test(message) })
    }
  }, [id, layout, edits])

  const panels = useMemo(() => foldEdits(layout?.panels ?? [], edits), [layout, edits])
  const rows = useMemo(() => {
    if (!layout) return undefined
    try {
      return foldStructure(layout.rows, edits)
    } catch {
      return layout.rows
    }
  }, [layout, edits])
  const byTitle = useMemo(() => {
    const out: EditState['layout'] = {}
    for (const panel of layout?.panels ?? []) {
      if (!layout?.duplicates.includes(panel.title)) out[panel.title] = panel
    }
    return out
  }, [layout])

  const editState: EditState = useMemo(
    () => ({
      editing: mode === 'edit' && Boolean(layout),
      panels,
      layout: byTitle,
      rows,
      sourceRows: layout?.rows,
      filters: layout?.filters ?? [],
      liveOrder,
      stage,
      setLiveOrder,
      configure: onConfigure,
      enterEdit: () => setMode('edit'),
    }),
    [mode, layout, panels, rows, byTitle, liveOrder, stage, onConfigure, setMode],
  )

  return { mode, setMode, layout, edits, status, stage, undo, discard, save, reload, editState }
}
