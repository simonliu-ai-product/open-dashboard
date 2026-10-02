export { Select, type SelectProps, TimeRange, type TimeRangeProps } from './components/filters.js'
export {
  Dashboard,
  type DashboardProps,
  Filters,
  Row,
  type RowProps,
  Section,
  type SectionProps,
} from './components/layout.js'
export type { PanelProps } from './components/panel.js'
export { PieChart, type PieChartProps } from './components/pie-chart.js'
export { Stat, type StatProps } from './components/stat.js'
export { Table, type TableColumn, type TableProps } from './components/table.js'
export { Text, type TextProps } from './components/text.js'
export {
  AreaChart,
  BarChart,
  type BarChartProps,
  LineChart,
  type LineChartProps,
  type XYProps,
} from './components/xy-chart.js'
export type {
  ColumnInfo,
  ColumnType,
  DatasourceConfig,
  MysqlSource,
  OpenDashboardConfig,
  ParamValue,
  PostgresSource,
  QueryResult,
  Row as ResultRow,
  SqliteSource,
} from './config.js'
export { HostContext, type HostContextValue, useFilters, useHost } from './runtime/context.js'
export { formatValue } from './runtime/format.js'
export { TIME_PRESETS, type TimePreset } from './runtime/time-range.js'
export type { DashboardMeta, Format, NamedFormat, PanelInfo, QueryRun } from './runtime/types.js'
export { type QueryState, useQuery } from './runtime/use-query.js'

export function defineConfig<T extends import('./config.js').OpenDashboardConfig>(config: T): T {
  return config
}
