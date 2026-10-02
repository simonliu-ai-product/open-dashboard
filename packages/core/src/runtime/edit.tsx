import { type Context, createContext, useContext } from 'react'
import {
  applyProps,
  convertProps,
  type LayoutEdit,
  type PanelType,
  type PropValue,
} from './convert.js'
import { applyStructure, type RowShape } from './structure.js'

export interface PanelEdit {
  component?: PanelType
  /** Prop changes on top of what the source says; null removes. */
  changes: Record<string, PropValue>
  /** Position among its row's panels, once reordered. */
  order?: number
}

export interface LayoutPanel {
  title: string
  component: string
  props: Record<string, unknown>
  locked: string[]
  siblings: string[]
  inRow: boolean
}

/**
 * The staged edits, replayed into what each panel should look like. The same
 * conversion the server will write runs here, so the preview is the save.
 */
export function foldEdits(panels: LayoutPanel[], edits: LayoutEdit[]): Record<string, PanelEdit> {
  const out: Record<string, PanelEdit> = {}
  const base = new Map(panels.map((p) => [p.title, p]))
  const entry = (title: string) => {
    out[title] ??= { changes: {} }
    return out[title] as PanelEdit
  }
  for (const edit of edits) {
    if (edit.kind === 'props') {
      const panel = entry(edit.title)
      panel.changes = { ...panel.changes, ...edit.set }
    } else if (edit.kind === 'component') {
      const panel = entry(edit.title)
      const source = base.get(edit.title)
      const from = panel.component ?? source?.component ?? edit.component
      const props = applyProps(source?.props ?? {}, panel.changes)
      panel.changes = { ...panel.changes, ...convertProps(from, edit.component, props) }
      panel.component = edit.component
    } else if (edit.kind === 'order') {
      edit.titles.forEach((title, index) => {
        entry(title).order = index
      })
    }
  }
  return out
}

/** The rows as staged: the source's rows with every move and row move applied. */
export function foldStructure(rows: RowShape[], edits: LayoutEdit[]): RowShape[] {
  let current = rows
  for (const edit of edits) {
    if (edit.kind === 'move' || edit.kind === 'moveRow') current = applyStructure(current, edit)
  }
  return current
}

/** Consecutive prop edits to one panel are one step: a drag is one undo, not forty. */
export function stageEdit(edits: LayoutEdit[], next: LayoutEdit): LayoutEdit[] {
  const last = edits[edits.length - 1]
  if (last?.kind === 'props' && next.kind === 'props' && last.title === next.title) {
    return [...edits.slice(0, -1), { ...last, set: { ...last.set, ...next.set } }]
  }
  if (
    last?.kind === 'order' &&
    next.kind === 'order' &&
    [...last.titles].sort().join('\n') === [...next.titles].sort().join('\n')
  ) {
    return [...edits.slice(0, -1), next]
  }
  return [...edits, next]
}

export interface EditState {
  editing: boolean
  panels: Record<string, PanelEdit>
  layout: Record<string, LayoutPanel>
  /** Rows as staged, in document order; undefined until the layout has loaded. */
  rows: RowShape[] | undefined
  /** Rows as the source last had them — what the page's element tree should match. */
  sourceRows: RowShape[] | undefined
  /** The dashboard's <Select> names: what a click can drill into. */
  filters: string[]
  /** Row order while a panel is being dragged, before it is staged. */
  liveOrder: string[] | undefined
  stage(edit: LayoutEdit): void
  setLiveOrder(titles: string[] | undefined): void
  /** Open the inspector on a panel's visualization settings. */
  configure(title: string): void
}

const store = globalThis as typeof globalThis & { __openDashboardEdit?: Context<EditState> }
store.__openDashboardEdit ??= createContext<EditState>({
  editing: false,
  panels: {},
  layout: {},
  rows: undefined,
  sourceRows: undefined,
  filters: [],
  liveOrder: undefined,
  stage: () => {},
  setLiveOrder: () => {},
  configure: () => {},
})
export const EditContext = store.__openDashboardEdit

export function useEdit(): EditState {
  return useContext(EditContext)
}

/** A panel's props as staged: the source's, with the page's changes on top. */
export function usePanelEdit(title: string | undefined): PanelEdit | undefined {
  const state = useEdit()
  return title ? state.panels[title] : undefined
}
