import { charts as entries } from 'virtual:open-dashboard/manifest'
import { type ComponentType, useEffect, useMemo, useState } from 'react'
import '../../index.js'
import { panelImplementation } from '../../components/editable.js'
import type { CatalogEntry } from '../../ops/charts.js'
import type { DashboardSummary } from '../../ops/dashboards.js'
import { CHART_GROUPS, TYPE_LABELS } from '../../runtime/catalog.js'
import { FilterContext, HostContext, type HostContextValue } from '../../runtime/context.js'
import { useT } from '../../runtime/i18n.js'
import { CHART_ICONS } from '../components/chart-icons.js'
import { CommandButton } from '../components/command-button.js'
import { api } from '../lib/api.js'
import { linkProps, navigate } from '../lib/router.js'

type Panel = ComponentType<Record<string, unknown>>

const EVENTS = ['odd:charts-changed', 'odd:queries-changed', 'vite:afterUpdate']

function useCatalog(): CatalogEntry[] | undefined {
  const [list, setList] = useState<CatalogEntry[]>()
  useEffect(() => {
    let live = true
    const load = () =>
      api.charts().then(
        (found) => live && setList(found),
        () => live && setList([]),
      )
    load()
    for (const event of EVENTS) import.meta.hot?.on(event, load)
    return () => {
      live = false
      for (const event of EVENTS) import.meta.hot?.off?.(event, load)
    }
  }, [])
  return list
}

function useCustomComponent(id: string | undefined): Panel | undefined {
  const [component, setComponent] = useState<Panel>()
  useEffect(() => {
    const entry = entries.find((chart) => chart.id === id)
    if (!entry) return
    let live = true
    entry.load().then((module) => {
      if (live && typeof module.default === 'function') setComponent(() => module.default as Panel)
    })
    return () => {
      live = false
    }
  }, [id])
  return component
}

const keyOf = (entry: CatalogEntry) => (entry.kind === 'custom' ? (entry.id as string) : entry.name)

function CustomIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d="M8 2.5 13.2 6.3 11.2 12.5H4.8L2.8 6.3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </svg>
  )
}

function ChartIcon({ entry }: { entry: CatalogEntry }) {
  const Icon = entry.kind === 'built-in' ? CHART_ICONS[entry.name] : undefined
  return <span className="odd-chart-icon">{Icon ? <Icon /> : <CustomIcon />}</span>
}

function useLabel() {
  const t = useT()
  return (entry: CatalogEntry) =>
    entry.kind === 'built-in' ? t(TYPE_LABELS[entry.name] ?? entry.name) : entry.name
}

export function ChartsView({
  id,
  dashboards,
}: {
  id?: string
  dashboards: DashboardSummary[] | undefined
}) {
  const t = useT()
  const label = useLabel()
  const catalog = useCatalog()
  const [query, setQuery] = useState('')
  const selected = catalog?.find((entry) => keyOf(entry) === id) ?? catalog?.[0]

  useEffect(() => {
    if (!id && selected)
      navigate(`/charts/${encodeURIComponent(keyOf(selected))}`, { replace: true })
  }, [id, selected])

  const needle = query.trim().toLowerCase()
  const shown = catalog?.filter(
    (entry) =>
      !needle ||
      entry.name.toLowerCase().includes(needle) ||
      label(entry).toLowerCase().includes(needle) ||
      entry.columns.some((column) => column.toLowerCase().includes(needle)),
  )
  const custom = shown?.filter((entry) => entry.kind === 'custom') ?? []
  const groups = CHART_GROUPS.map((group) => ({
    label: group.label,
    items:
      shown?.filter(
        (entry) =>
          entry.kind === 'built-in' &&
          (entry.group === group.label || (group.label === 'Basics' && entry.name === 'Text')),
      ) ?? [],
  })).filter((group) => group.items.length > 0)

  const item = (entry: CatalogEntry) => (
    <a
      key={keyOf(entry)}
      {...linkProps(`/charts/${encodeURIComponent(keyOf(entry))}`)}
      aria-current={selected && keyOf(entry) === keyOf(selected) ? 'page' : undefined}
    >
      <ChartIcon entry={entry} />
      <span className="odd-gallery-name">{label(entry)}</span>
      {entry.usedBy.length ? (
        <span className="odd-gallery-count">{entry.usedBy.length}</span>
      ) : null}
    </a>
  )

  return (
    <div className="odd-page odd-studio-page odd-charts-page">
      <header className="odd-studio-head">
        <h1>{t('Charts')}</h1>
      </header>
      <div className="odd-gallery">
        <nav className="odd-gallery-list" aria-label={t('Charts')}>
          <input
            type="search"
            className="odd-gallery-search"
            value={query}
            placeholder={t('Search')}
            aria-label={t('Search')}
            onChange={(event) => setQuery(event.target.value)}
          />
          {custom.length || !needle ? (
            <div className="odd-gallery-group">
              <h2>{t('Custom')}</h2>
              {custom.length ? custom.map(item) : <CommandButton command="/create-chart" />}
            </div>
          ) : null}
          {groups.map((group) => (
            <div key={group.label} className="odd-gallery-group">
              <h2>{t(group.label)}</h2>
              {group.items.map(item)}
            </div>
          ))}
        </nav>
        {selected ? (
          <ChartDetail key={keyOf(selected)} entry={selected} dashboards={dashboards ?? []} />
        ) : null}
      </div>
    </div>
  )
}

function ChartDetail({
  entry,
  dashboards,
}: {
  entry: CatalogEntry
  dashboards: DashboardSummary[]
}) {
  const t = useT()
  const label = useLabel()
  const custom = useCustomComponent(entry.kind === 'custom' ? entry.id : undefined)
  const titles = new Map(dashboards.map((d) => [d.id, d.title]))
  const dashboardsUsing = [...new Set(entry.usedBy.map((use) => use.dashboard))]

  return (
    <article className="odd-gallery-detail">
      <header className="odd-gallery-head">
        <ChartIcon entry={entry} />
        <h2>{label(entry)}</h2>
        <code>{entry.kind === 'custom' ? entry.file : `<${entry.name}>`}</code>
        <span className="odd-badge">{entry.kind === 'custom' ? t('Custom') : t('Built-in')}</span>
      </header>

      <div className="odd-gallery-stage">
        {entry.kind === 'custom' ? (
          <CustomPreview entry={entry} component={custom} />
        ) : (
          <BuiltInPreview entry={entry} />
        )}
      </div>

      <dl className="odd-gallery-facts">
        <div>
          <dt>{t('Column props')}</dt>
          <dd className="odd-chips">
            {entry.columns.length
              ? entry.columns.map((column) => <code key={column}>{column}</code>)
              : '—'}
          </dd>
        </div>
        <div>
          <dt>{t('Used by')}</dt>
          <dd className="odd-chips">
            {dashboardsUsing.length
              ? dashboardsUsing.map((id) => (
                  <a key={id} {...linkProps(`/d/${encodeURIComponent(id)}`)}>
                    {titles.get(id) ?? id}
                  </a>
                ))
              : '—'}
          </dd>
        </div>
      </dl>
    </article>
  )
}

function EmptyStage({ entry }: { entry: CatalogEntry }) {
  return (
    <div className="odd-gallery-placeholder" aria-hidden="true">
      <ChartIcon entry={entry} />
    </div>
  )
}

function CustomPreview({
  entry,
  component: Component,
}: {
  entry: CatalogEntry
  component?: Panel
}) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onChange = (data: unknown) => {
      const changed = (data as { id?: string } | undefined)?.id
      if (!changed || changed === entry.id) setTick((n) => n + 1)
    }
    import.meta.hot?.on('odd:charts-changed', onChange)
    return () => import.meta.hot?.off?.('odd:charts-changed', onChange)
  }, [entry.id])
  const host: HostContextValue = useMemo(
    () => ({
      id: `chart-${entry.id}`,
      meta: { title: entry.name },
      tick,
      refresh: () => setTick((n) => n + 1),
      inspect: () => {},
      inspectable: false,
      onParams: () => {},
      fetchQuery: (name, params) => api.chartQuery(entry.id as string, name, params),
    }),
    [entry.id, entry.name, tick],
  )
  const sample = entry.sample && entry.queries?.includes(entry.sample.query) ? entry.sample : null
  if (!sample || !Component) return <EmptyStage entry={entry} />
  return (
    <HostContext.Provider value={host}>
      <Component title={entry.name} query={sample.query} {...sample.props} />
    </HostContext.Provider>
  )
}

/** A built-in drawn as a dashboard in this workspace uses it: real data, that dashboard's default filters. */
function BuiltInPreview({ entry }: { entry: CatalogEntry }) {
  const example = entry.example
  const host: HostContextValue | undefined = useMemo(
    () =>
      example
        ? {
            id: example.dashboard,
            meta: { title: example.title, ...example.meta },
            tick: 0,
            refresh: () => {},
            inspect: () => {},
            inspectable: false,
            onParams: () => {},
            fetchQuery: (name, params) => api.query(example.dashboard, name, params),
          }
        : undefined,
    [example],
  )
  const filters = useMemo(
    () => ({ values: {}, params: example?.params ?? {}, set: () => {} }),
    [example],
  )
  const Component = panelImplementation(entry.name)
  if (!example || !host || !Component) return <EmptyStage entry={entry} />
  const { span: _span, ...props } = example.props
  return (
    <HostContext.Provider value={host}>
      <FilterContext.Provider value={filters}>
        <Component {...props} />
      </FilterContext.Provider>
    </HostContext.Provider>
  )
}
