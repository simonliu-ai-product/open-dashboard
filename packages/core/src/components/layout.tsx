import {
  Children,
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

export interface FilterSpec {
  key: string
  default: string | null
  params(value: string | null): Record<string, ParamValue>
}

type FilterComponent = { filterSpec?: (props: Record<string, unknown>) => FilterSpec }

export const RowContext = createContext<{ span: number; height: number | undefined }>({
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

export interface DashboardProps {
  children?: ReactNode
}

export function Dashboard({ children }: DashboardProps) {
  const host = useHost()
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
          <RowContext.Provider value={{ span: 12, height: undefined }}>{body}</RowContext.Provider>
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
export function Row({ children, height }: RowProps) {
  const count = flatten(children).filter(isValidElement).length
  const span = Math.max(1, Math.floor(12 / Math.max(1, count)))
  return (
    <div className="odd-row">
      <RowContext.Provider value={{ span, height }}>{children}</RowContext.Provider>
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
