export { BandChart, type BandChartProps } from './components/band-chart.js'
export { BoxPlot, type BoxPlotProps } from './components/box-plot.js'
export { BulletChart, type BulletChartProps } from './components/bullet-chart.js'
export { BumpChart, type BumpChartProps } from './components/bump-chart.js'
export { CalendarHeatmap, type CalendarHeatmapProps } from './components/calendar-heatmap.js'
export { Candlestick, type CandlestickProps } from './components/candlestick.js'
export { ChoroplethMap, type ChoroplethMapProps } from './components/choropleth-map.js'
export { CohortTable, type CohortTableProps } from './components/cohort-table.js'
export { ControlChart, type ControlChartProps } from './components/control-chart.js'
export {
  type ChartContext,
  type ChartDefinition,
  type CustomChartProps,
  defineChart,
} from './components/define-chart.js'
export { DivergingBar, type DivergingBarProps } from './components/diverging-bar.js'
export { DotPlot, type DotPlotProps } from './components/dot-plot.js'
export { Dumbbell, type DumbbellProps } from './components/dumbbell.js'
export { EcdfChart, type EcdfChartProps } from './components/ecdf-chart.js'
export { Select, type SelectProps, TimeRange, type TimeRangeProps } from './components/filters.js'
export { FunnelChart, type FunnelChartProps } from './components/funnel-chart.js'
export { Gantt, type GanttProps } from './components/gantt.js'
export { Gauge, type GaugeProps } from './components/gauge.js'
export { Heatmap, type HeatmapProps } from './components/heatmap.js'
export { Histogram, type HistogramProps } from './components/histogram.js'
export { HorizonChart, type HorizonChartProps } from './components/horizon-chart.js'
export {
  Dashboard,
  type DashboardProps,
  Filters,
  Row,
  type RowProps,
  Section,
  type SectionProps,
} from './components/layout.js'
export { Marimekko, type MarimekkoProps } from './components/marimekko.js'
export type { PanelProps } from './components/panel.js'
export { useFormatContext, useSize } from './components/panel.js'
export { ParetoChart, type ParetoChartProps } from './components/pareto-chart.js'
export { PieChart, type PieChartProps } from './components/pie-chart.js'
export { PivotTable, type PivotTableProps } from './components/pivot-table.js'
export { Sankey, type SankeyProps } from './components/sankey.js'
export { ScatterChart, type ScatterChartProps } from './components/scatter-chart.js'
export { SlopeChart, type SlopeChartProps } from './components/slope-chart.js'
export { SmallMultiples, type SmallMultiplesProps } from './components/small-multiples.js'
export { Stat, type StatProps } from './components/stat.js'
export { StateTimeline, type StateTimelineProps } from './components/state-timeline.js'
export { StripPlot, type StripPlotProps } from './components/strip-plot.js'
export { SymbolMap, type SymbolMapProps } from './components/symbol-map.js'
export { Table, type TableColumn, type TableProps } from './components/table.js'
export { Text, type TextProps } from './components/text.js'
export { TileMap, type TileMapProps } from './components/tile-map.js'
export { Timeline, type TimelineProps } from './components/timeline.js'
export { ChartTooltip, type TipRow } from './components/tooltip.js'
export { Treemap, type TreemapProps } from './components/treemap.js'
export { UpSetChart, type UpSetChartProps } from './components/upset-chart.js'
export { Waterfall, type WaterfallProps } from './components/waterfall.js'
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
export { diverging, sequential, seriesColor } from './runtime/color.js'
export { HostContext, type HostContextValue, useFilters, useHost } from './runtime/context.js'
export { formatValue, tickFormatter } from './runtime/format.js'
export { linear, niceDomain } from './runtime/scale.js'
export { TIME_PRESETS, type TimePreset } from './runtime/time-range.js'
export type { DashboardMeta, Format, NamedFormat, PanelInfo, QueryRun } from './runtime/types.js'
export { type QueryState, useQuery } from './runtime/use-query.js'

export function defineConfig<T extends import('./config.js').OpenDashboardConfig>(config: T): T {
  return config
}
