/**
 * Every built-in panel, grouped by the job it does, with the name the viewer
 * shows for it. Shared by the type picker, the Charts page and
 * `open-dashboard charts`, so the three never list different things.
 */

export const CHART_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Basics', types: ['LineChart', 'AreaChart', 'BarChart', 'PieChart', 'Table', 'Stat'] },
  {
    label: 'Compare and rank',
    types: [
      'DotPlot',
      'Dumbbell',
      'BulletChart',
      'DivergingBar',
      'Marimekko',
      'SlopeChart',
      'BumpChart',
    ],
  },
  {
    label: 'Over time',
    types: [
      'Waterfall',
      'CalendarHeatmap',
      'SmallMultiples',
      'BandChart',
      'ControlChart',
      'HorizonChart',
      'Timeline',
      'Candlestick',
    ],
  },
  {
    label: 'Distribution and relationship',
    types: ['Histogram', 'BoxPlot', 'StripPlot', 'EcdfChart', 'ParetoChart', 'ScatterChart'],
  },
  {
    label: 'Flow and composition',
    types: ['Sankey', 'CohortTable', 'UpSetChart', 'FunnelChart', 'Treemap', 'Heatmap'],
  },
  { label: 'Maps', types: ['ChoroplethMap', 'SymbolMap', 'TileMap'] },
  { label: 'Status and tables', types: ['Gauge', 'StateTimeline', 'PivotTable'] },
]

export const TYPE_LABELS: Record<string, string> = {
  LineChart: 'Line',
  AreaChart: 'Area',
  BarChart: 'Bar',
  PieChart: 'Pie',
  Table: 'Table view',
  Stat: 'Number',
  ScatterChart: 'Scatter',
  Heatmap: 'Heatmap',
  FunnelChart: 'Funnel',
  Gauge: 'Gauge',
  Treemap: 'Treemap',
  DotPlot: 'Dot plot',
  Dumbbell: 'Dumbbell',
  BulletChart: 'Bullet',
  DivergingBar: 'Diverging bar',
  Marimekko: 'Marimekko',
  SlopeChart: 'Slope',
  BumpChart: 'Bump',
  Waterfall: 'Waterfall',
  CalendarHeatmap: 'Calendar',
  SmallMultiples: 'Small multiples',
  BandChart: 'Band',
  ControlChart: 'Control chart',
  HorizonChart: 'Horizon',
  Timeline: 'Timeline',
  Candlestick: 'Candlestick',
  Histogram: 'Histogram',
  BoxPlot: 'Box plot',
  StripPlot: 'Strip plot',
  EcdfChart: 'Cumulative',
  ParetoChart: 'Concentration',
  Sankey: 'Sankey',
  CohortTable: 'Cohort',
  UpSetChart: 'Set overlaps',
  ChoroplethMap: 'Region map',
  SymbolMap: 'Point map',
  TileMap: 'Tile map',
  StateTimeline: 'State timeline',
  PivotTable: 'Pivot table',
  Text: 'Text',
}

/** Every built-in panel, in catalog order. `Text` is a panel but not a chart type. */
export const BUILT_IN_PANELS: string[] = [...CHART_GROUPS.flatMap((group) => group.types), 'Text']
