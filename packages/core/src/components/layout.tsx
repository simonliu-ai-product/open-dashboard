import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ParamValue } from '../config.js'
import { FilterContext, type FilterState, useHost } from '../runtime/context.js'
import { type EditState, useEdit } from '../runtime/edit.js'
import type { RowShape } from '../runtime/structure.js'
import { useRowDrag } from './edit-chrome.js'

export interface FilterSpec {
  key: string
  default: string | null
  params(value: string | null): Record<string, ParamValue>
}

type FilterComponent = { filterSpec?: (props: Record<string, unknown>) => FilterSpec }

export interface RowInfo {
  span: number
  height: number | undefined
  /** This row's position among the staged rows, in edit mode. */
  rowIndex?: number
}

export const RowContext = createContext<RowInfo>({
  span: 12,
  height: undefined,
})

export function useRow() {
  return useContext(RowContext)
}

export function Filters({ children }: { children?: ReactNode }) {
  return <div className="odd-filters">{children}</div>
}

function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = []
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === Fragment) {
      out.push(...flatten((child.props as { children?: ReactNode }).children))
    } else {
      out.push(child)
    }
  })
  return out
}

/**
 * Filters are found by walking the element tree *before* any panel mounts, so
 * the very first query already carries the filter defaults. Registering from a
 * filter's own effect would let every panel fire once with no params and fail.
 */
function collectSpecs(nodes: ReactNode[]): FilterSpec[] {
  const specs: FilterSpec[] = []
  const visit = (node: ReactNode) => {
    if (!isValidElement(node)) return
    const type = node.type as unknown as FilterComponent | string
    const props = node.props as Record<string, unknown> & { children?: ReactNode }
    if (typeof type !== 'string' && type.filterSpec) specs.push(type.filterSpec(props))
    Children.forEach(props.children, visit)
  }
  nodes.forEach(visit)
  return specs
}

function readUrl(specs: FilterSpec[]): Record<string, string | null> {
  const search =
    typeof window === 'undefined'
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search)
  const values: Record<string, string | null> = {}
  for (const spec of specs) {
    const raw = search.get(spec.key)
    values[spec.key] = raw === null ? spec.default : raw === '' ? null : raw
  }
  return values
}

function writeUrl(specs: FilterSpec[], values: Record<string, string | null>): void {
  const url = new URL(window.location.href)
  for (const spec of specs) {
    const value = values[spec.key] ?? null
    if (value === spec.default) url.searchParams.delete(spec.key)
    else url.searchParams.set(spec.key, value ?? '')
  }
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
}

function titleOf(node: ReactNode): string | undefined {
  if (!isValidElement(node)) return undefined
  const title = (node.props as { title?: unknown }).title
  return typeof title === 'string' ? title : undefined
}

function rowTitles(row: ReactElement): string[] {
  return flatten((row.props as { children?: ReactNode }).children)
    .map(titleOf)
    .filter((title): title is string => title !== undefined)
}

function collectRows(nodes: ReactNode[], out: ReactElement[]): ReactElement[] {
  for (const node of nodes) {
    if (!isValidElement(node)) continue
    if (node.type === Row) out.push(node)
    else if (node.type === Section)
      collectRows(flatten((node.props as { children?: ReactNode }).children), out)
  }
  return out
}

function keyed(node: ReactNode, key: string): ReactNode {
  return isValidElement(node) && node.key === null ? cloneElement(node, { key }) : node
}

/**
 * The page's element tree, rebuilt to match the staged rows: panels in their
 * new rows (keyed by title, so a move within a parent keeps the same DOM node),
 * rows in their new slots, emptied rows gone. Only when the tree's rows are
 * exactly the source's rows — rows built by a loop, say, are left as written.
 */
function arrange(body: ReactNode[], edit: EditState): ReactNode[] {
  const staged = edit.rows
  const source = edit.sourceRows
  if (!edit.editing || !staged || !source) return body.map((node, i) => keyed(node, `n${i}`))
  const rows = collectRows(body, [])
  const matches =
    rows.length === source.length &&
    rows.every((row, i) => rowTitles(row).join('\n') === source[i]?.titles.join('\n'))
  if (!matches) return body.map((node, i) => keyed(node, `n${i}`))

  const panels = new Map<string, ReactNode>()
  for (const row of rows) {
    for (const child of flatten((row.props as { children?: ReactNode }).children)) {
      const title = titleOf(child)
      if (title) panels.set(title, child)
    }
  }

  const rebuild = (nodes: ReactNode[]): ReactNode[] => {
    const parentKey = (() => {
      for (const node of nodes) {
        if (isValidElement(node) && node.type === Row) return source[rows.indexOf(node)]?.parent
      }
      return undefined
    })()
    const mine = staged.filter((row: RowShape) => row.parent === parentKey)
    let slot = 0
    return nodes.map((node, i) => {
      if (!isValidElement(node)) return node
      if (node.type === Row) {
        const row = mine[slot++]
        if (!row) return null
        const original = rows[row.id] as ReactElement
        return cloneElement(
          original,
          { key: `row-${row.id}`, __rowIndex: staged.indexOf(row) } as Record<string, unknown>,
          ...row.titles.map((title) =>
            keyed(cloneElement(panels.get(title) as ReactElement, { key: title }), title),
          ),
        )
      }
      if (node.type === Section) {
        const children = flatten((node.props as { children?: ReactNode }).children)
        return cloneElement(node, { key: node.key ?? `n${i}` }, ...rebuild(children))
      }
      return keyed(node, `n${i}`)
    })
  }
  return rebuild(body)
}

export interface DashboardProps {
  children?: ReactNode
}

export function Dashboard({ children }: DashboardProps) {
  const host = useHost()
  const edit = useEdit()
  const nodes = flatten(children)
  const filterNodes = nodes.filter((node) => isValidElement(node) && node.type === Filters)
  const body = nodes.filter((node) => !(isValidElement(node) && node.type === Filters))
  const specs = collectSpecs(filterNodes)
  const specKey = specs.map((s) => `${s.key}=${s.default}`).join('&')

  const [values, setValues] = useState(() => readUrl(specs))

  // biome-ignore lint/correctness/useExhaustiveDependencies: specKey stands for specs
  useEffect(() => {
    setValues((previous) => {
      const next: Record<string, string | null> = {}
      for (const spec of specs)
        next[spec.key] = spec.key in previous ? (previous[spec.key] ?? null) : spec.default
      return next
    })
  }, [specKey])

  // biome-ignore lint/correctness/useExhaustiveDependencies: specKey stands for specs
  const params = useMemo(() => {
    const out: Record<string, ParamValue> = {}
    for (const spec of specs)
      Object.assign(
        out,
        spec.params(spec.key in values ? (values[spec.key] ?? null) : spec.default),
      )
    return out
  }, [values, specKey])
  const paramsKey = JSON.stringify(params)

  // biome-ignore lint/correctness/useExhaustiveDependencies: paramsKey stands for params
  useEffect(() => {
    writeUrl(specs, values)
    host.onParams(params)
  }, [paramsKey])

  const state: FilterState = useMemo(
    () => ({
      values,
      params,
      set: (key, value) => setValues((previous) => ({ ...previous, [key]: value })),
    }),
    [values, params],
  )

  return (
    <FilterContext.Provider value={state}>
      <div className="odd-dashboard">
        <header className="odd-dash-header">
          <div className="odd-dash-titles">
            <h1>{host.meta.title}</h1>
            {host.meta.description ? <p>{host.meta.description}</p> : null}
          </div>
          {filterNodes.length > 0 ? <div className="odd-dash-filters">{filterNodes}</div> : null}
        </header>
        <div className="odd-grid">
          <RowContext.Provider value={{ span: 12, height: undefined }}>
            {arrange(body, edit)}
          </RowContext.Provider>
        </div>
      </div>
    </FilterContext.Provider>
  )
}

export interface RowProps {
  children?: ReactNode
  /** Panel height in px for every panel in the row. Each panel's own `height` wins. */
  height?: number
}

/** A 12-column band. Panels split it evenly unless they set `span`. */
export function Row({ children, height, ...rest }: RowProps) {
  const rowIndex = (rest as { __rowIndex?: number }).__rowIndex
  const count = flatten(children).filter(isValidElement).length
  const span = Math.max(1, Math.floor(12 / Math.max(1, count)))
  const drag = useRowDrag(rowIndex)
  return (
    <div
      className="odd-row"
      data-row-index={rowIndex}
      data-row-parent={drag.parent}
      data-dragging={drag.dragging || undefined}
      ref={drag.ref}
    >
      {drag.grip}
      <RowContext.Provider
        value={{ span, height, ...(rowIndex === undefined ? {} : { rowIndex }) }}
      >
        {children}
      </RowContext.Provider>
    </div>
  )
}

export interface SectionProps {
  title: string
  description?: string
  children?: ReactNode
}

/** A heading across the grid, for grouping rows on a long dashboard. */
export function Section({ title, description, children }: SectionProps): ReactElement {
  return (
    <section className="odd-section">
      <div className="odd-section-head">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="odd-grid">
        <RowContext.Provider value={{ span: 12, height: undefined }}>
          {children}
        </RowContext.Provider>
      </div>
    </section>
  )
}
