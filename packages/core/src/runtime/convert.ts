/**
 * What happens to a panel's props when its type changes. One table, used by
 * the browser to preview the change and by the server to write it, so what is
 * saved is exactly what was shown.
 */
export type PropValue = string | number | boolean | string[] | null

export type LayoutEdit =
  | { kind: 'props'; title: string; set: Record<string, PropValue> }
  | { kind: 'component'; title: string; component: PanelType }
  | { kind: 'order'; titles: string[] }
  | { kind: 'move'; title: string; row: number; index: number }
  | { kind: 'moveRow'; from: number; to: number }

/** What a panel's props mean: which prop holds its category, its measure and its grouping. */
export interface Roles {
  category?: string
  measure?: string
  group?: string
}

interface PanelSpec {
  /** Every prop the panel reads, beyond the common ones. */
  props: string[]
  roles: Roles
  /** Props that name result columns — what `check` verifies against the query. */
  columns: string[]
}

const COMMON = ['title', 'description', 'span', 'height', 'query', 'drill']
const XY = ['x', 'y', 'series', 'format', 'stacked', 'labels']
const XY_ROLES: Roles = { category: 'x', measure: 'y', group: 'series' }
const PARTS: Roles = { category: 'label', measure: 'value' }

/**
 * The one registry of panel types. Analysis, the edit whitelist, type
 * conversion and the chart picker all read it, so a new chart is added here
 * once and nowhere else forgets it.
 */
export const PANEL_SPECS = {
  LineChart: { props: [...XY, 'area'], roles: XY_ROLES, columns: ['x', 'y', 'series'] },
  AreaChart: { props: XY, roles: XY_ROLES, columns: ['x', 'y', 'series'] },
  BarChart: { props: [...XY, 'horizontal'], roles: XY_ROLES, columns: ['x', 'y', 'series'] },
  PieChart: {
    props: ['label', 'value', 'format', 'maxSlices'],
    roles: PARTS,
    columns: ['label', 'value'],
  },
  Table: { props: ['columns', 'sort'], roles: {}, columns: [] },
  Stat: {
    props: ['column', 'format', 'compare', 'compareLabel', 'invert', 'spark'],
    roles: { measure: 'column' },
    columns: ['column', 'compare'],
  },
  ScatterChart: {
    props: ['x', 'y', 'series', 'size', 'label', 'format', 'xFormat'],
    roles: XY_ROLES,
    columns: ['x', 'y', 'series', 'size', 'label'],
  },
  Heatmap: {
    props: ['x', 'y', 'value', 'format'],
    roles: { category: 'x', measure: 'value', group: 'y' },
    columns: ['x', 'y', 'value'],
  },
  FunnelChart: { props: ['label', 'value', 'format'], roles: PARTS, columns: ['label', 'value'] },
  Gauge: {
    props: ['column', 'max', 'target', 'format'],
    roles: { measure: 'column' },
    columns: ['column', 'max', 'target'],
  },
  Treemap: {
    props: ['label', 'value', 'format', 'maxItems', 'group'],
    roles: { ...PARTS, group: 'group' },
    columns: ['label', 'value', 'group'],
  },
  DotPlot: {
    props: ['label', 'value', 'format', 'zero'],
    roles: PARTS,
    columns: ['label', 'value'],
  },
  Dumbbell: {
    props: ['label', 'from', 'to', 'format', 'labels', 'zero'],
    roles: { category: 'label', measure: 'to' },
    columns: ['label', 'from', 'to'],
  },
  BulletChart: {
    props: ['label', 'value', 'target', 'max', 'bands', 'format'],
    roles: PARTS,
    columns: ['label', 'value', 'target', 'max', 'bands'],
  },
  DivergingBar: {
    props: ['label', 'value', 'format', 'invert'],
    roles: PARTS,
    columns: ['label', 'value'],
  },
  Marimekko: {
    props: ['x', 'series', 'value', 'format'],
    roles: { category: 'x', measure: 'value', group: 'series' },
    columns: ['x', 'series', 'value'],
  },
  SlopeChart: {
    props: ['label', 'from', 'to', 'format', 'labels', 'zero'],
    roles: { category: 'label', measure: 'to' },
    columns: ['label', 'from', 'to'],
  },
  BumpChart: {
    props: ['x', 'series', 'value', 'ascending', 'top', 'format'],
    roles: { category: 'x', measure: 'value', group: 'series' },
    columns: ['x', 'series', 'value'],
  },
  Waterfall: {
    props: ['label', 'value', 'type', 'total', 'format'],
    roles: PARTS,
    columns: ['label', 'value', 'type'],
  },
  CalendarHeatmap: {
    props: ['x', 'value', 'format'],
    roles: { category: 'x', measure: 'value' },
    columns: ['x', 'value'],
  },
  SmallMultiples: {
    props: ['x', 'y', 'series', 'kind', 'independent', 'format'],
    roles: XY_ROLES,
    columns: ['x', 'y', 'series'],
  },
  BandChart: {
    props: ['x', 'y', 'low', 'high', 'low2', 'high2', 'format'],
    roles: { category: 'x', measure: 'y' },
    columns: ['x', 'y', 'low', 'high', 'low2', 'high2'],
  },
  ControlChart: {
    props: ['x', 'y', 'center', 'upper', 'lower', 'format'],
    roles: { category: 'x', measure: 'y' },
    columns: ['x', 'y', 'center', 'upper', 'lower'],
  },
  HorizonChart: {
    props: ['x', 'series', 'y', 'bands', 'format'],
    roles: XY_ROLES,
    columns: ['x', 'series', 'y'],
  },
  Timeline: {
    props: ['label', 'start', 'end', 'series', 'now'],
    roles: { category: 'label', group: 'series' },
    columns: ['label', 'start', 'end', 'series'],
  },
  Candlestick: {
    props: ['x', 'open', 'high', 'low', 'close', 'convention', 'format'],
    roles: { category: 'x' },
    columns: ['x', 'open', 'high', 'low', 'close'],
  },
  ChoroplethMap: {
    props: ['geo', 'featureKey', 'region', 'value', 'format', 'scale'],
    roles: { category: 'region', measure: 'value' },
    columns: ['region', 'value'],
  },
  SymbolMap: {
    props: ['lat', 'lng', 'size', 'label', 'series', 'format', 'geo'],
    roles: { category: 'label', measure: 'size', group: 'series' },
    columns: ['lat', 'lng', 'size', 'label', 'series'],
  },
  TileMap: {
    props: ['region', 'value', 'format', 'grid'],
    roles: { category: 'region', measure: 'value' },
    columns: ['region', 'value'],
  },
  StateTimeline: {
    props: ['x', 'series', 'state', 'end', 'states'],
    roles: { category: 'x', group: 'series' },
    columns: ['x', 'series', 'state', 'end'],
  },
  PivotTable: {
    props: ['rows', 'columns', 'value', 'agg', 'format', 'totals', 'heat'],
    roles: { category: 'rows', measure: 'value', group: 'columns' },
    columns: ['rows', 'columns', 'value'],
  },
  Histogram: {
    props: ['value', 'bin', 'count', 'bins', 'format'],
    roles: { measure: 'value' },
    columns: ['value', 'bin', 'count'],
  },
  BoxPlot: {
    props: ['value', 'label', 'stats', 'format'],
    roles: PARTS,
    columns: ['value', 'label', 'stats'],
  },
  StripPlot: { props: ['value', 'label', 'format'], roles: PARTS, columns: ['value', 'label'] },
  EcdfChart: {
    props: ['value', 'series', 'marks', 'format'],
    roles: { measure: 'value', group: 'series' },
    columns: ['value', 'series'],
  },
  ParetoChart: {
    props: ['label', 'value', 'at', 'format'],
    roles: PARTS,
    columns: ['label', 'value'],
  },
  Sankey: {
    props: ['source', 'target', 'value', 'format'],
    roles: { category: 'source', measure: 'value' },
    columns: ['source', 'target', 'value'],
  },
  CohortTable: {
    props: ['cohort', 'period', 'value', 'mode', 'size', 'format'],
    roles: { category: 'cohort', measure: 'value' },
    columns: ['cohort', 'period', 'value', 'size'],
  },
  UpSetChart: {
    props: ['sets', 'value', 'top', 'format'],
    roles: { category: 'sets', measure: 'value' },
    columns: ['sets', 'value'],
  },
} satisfies Record<string, PanelSpec>

export type PanelType = keyof typeof PANEL_SPECS
export const PANEL_TYPES = Object.keys(PANEL_SPECS) as PanelType[]

export const PANEL_PROPS: Record<PanelType | 'Text', string[]> = {
  ...(Object.fromEntries(
    PANEL_TYPES.map((type) => [type, [...COMMON, ...PANEL_SPECS[type].props]]),
  ) as Record<PanelType, string[]>),
  Text: ['title', 'span', 'height'],
}

export const ROLES = Object.fromEntries(
  PANEL_TYPES.map((type) => [type, PANEL_SPECS[type].roles]),
) as Record<PanelType, Roles>

/** Every panel component name, including Text, which has no query. */
export const PANEL_NAMES = new Set<string>([...PANEL_TYPES, 'Text'])

export function columnProps(component: string): string[] {
  return isPanelType(component) ? PANEL_SPECS[component].columns : []
}

export function isPanelType(value: unknown): value is PanelType {
  return typeof value === 'string' && (PANEL_TYPES as readonly string[]).includes(value)
}

function first(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

/** The panel's category, measure and grouping, whatever its type calls them. */
function meaning(
  from: string,
  props: Record<string, unknown>,
): Record<keyof Roles, string | undefined> {
  const roles = isPanelType(from) ? ROLES[from] : {}
  return {
    category: roles.category ? first(props[roles.category]) : undefined,
    measure: roles.measure ? first(props[roles.measure]) : undefined,
    group: roles.group ? first(props[roles.group]) : undefined,
  }
}

/**
 * The props to set (a value) or remove (null) when a panel of type `from` with
 * `props` becomes `to`. Each role — category, measure, grouping — carries over
 * under the name the new type gives it (`y` → `value` → `column`, `x` ↔
 * `label`, a heatmap's rows ↔ a chart's series). A prop the new type reads in
 * a different role than the old one wrote is cleared rather than misread, and
 * anything the new type does not understand is removed.
 */
export function convertProps(
  from: string,
  to: PanelType,
  props: Record<string, unknown>,
): Record<string, PropValue> {
  const changes: Record<string, PropValue> = {}
  if (from === to) return changes
  const source = isPanelType(from) ? ROLES[from] : {}
  const target = ROLES[to]
  const values = meaning(from, props)

  for (const role of ['category', 'measure', 'group'] as const) {
    const key = target[role]
    if (!key || source[role] === key) continue
    const value = values[role]
    if (value !== undefined) {
      if (props[key] !== value) changes[key] = value
    } else if (props[key] !== undefined && source[role] !== key) {
      changes[key] = null
    }
  }

  if (to === 'Table' && typeof props.format === 'string') changes.format = null
  const keep = new Set(PANEL_PROPS[to])
  for (const key of Object.keys(props)) {
    if (!keep.has(key) && !(key in changes)) changes[key] = null
  }
  return changes
}

/** `props` after `changes`: null removes. */
export function applyProps(
  props: Record<string, unknown>,
  changes: Record<string, PropValue>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...props }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}
