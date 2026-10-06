import type { ReactNode } from 'react'

const svg = (children: ReactNode) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

const dot = (cx: number, cy: number, r = 1.4) => (
  <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
)

/** One small glyph per chart type, drawn in the chart's own shape. */
export const CHART_ICONS: Record<string, () => ReactNode> = {
  LineChart: () => svg(<path d="M2 12l4-4 3 2 5-6" />),
  AreaChart: () =>
    svg(<path d="M2 13V10l4-4 3 2 5-5v10Z" fill="currentColor" fillOpacity="0.25" />),
  BarChart: () => svg(<path d="M3 13V8M8 13V3M13 13V6" />),
  PieChart: () =>
    svg(
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 2.5V8l4.5 3" />
      </>,
    ),
  Table: () =>
    svg(
      <>
        <rect x="2" y="3" width="12" height="10" rx="1.5" />
        <path d="M2 6.5h12M2 10h12M6 6.5V13" />
      </>,
    ),
  Stat: () => svg(<path d="M3 11.5h3.5M3 8.5h10M3 5h6" />),
  Text: () => svg(<path d="M3.5 4h9M8 4v8.5M6 12.5h4" />),
  ScatterChart: () => svg(<>{[dot(4, 11), dot(7.5, 7), dot(11, 9), dot(12.5, 4)]}</>),
  Heatmap: () =>
    svg(
      <>
        <rect
          x="2.5"
          y="2.5"
          width="5"
          height="5"
          rx="1"
          fill="currentColor"
          fillOpacity="0.85"
          stroke="none"
        />
        <rect
          x="8.5"
          y="2.5"
          width="5"
          height="5"
          rx="1"
          fill="currentColor"
          fillOpacity="0.35"
          stroke="none"
        />
        <rect
          x="2.5"
          y="8.5"
          width="5"
          height="5"
          rx="1"
          fill="currentColor"
          fillOpacity="0.2"
          stroke="none"
        />
        <rect
          x="8.5"
          y="8.5"
          width="5"
          height="5"
          rx="1"
          fill="currentColor"
          fillOpacity="0.6"
          stroke="none"
        />
      </>,
    ),
  FunnelChart: () => svg(<path d="M2.5 3.5h11M4.5 8h7M6.5 12.5h3" strokeWidth="2" />),
  Gauge: () =>
    svg(
      <>
        <path d="M2.5 11.5a5.5 5.5 0 0 1 11 0" />
        <path d="M8 11.5l2.5-3.5" />
      </>,
    ),
  Treemap: () =>
    svg(
      <>
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <path d="M8.5 2.5v11M8.5 8H14M5 8v5.5" />
      </>,
    ),
  DotPlot: () =>
    svg(
      <>
        <path d="M2 4h12M2 8h12M2 12h12" strokeOpacity="0.35" />
        {[dot(10, 4), dot(6, 8), dot(12, 12)]}
      </>,
    ),
  Dumbbell: () =>
    svg(
      <>
        <path d="M4 5h7M6 11h6" />
        {[dot(4, 5, 1.6), dot(11, 5, 1.6), dot(6, 11, 1.6), dot(12, 11, 1.6)]}
      </>,
    ),
  BulletChart: () =>
    svg(
      <>
        <rect
          x="2"
          y="5"
          width="12"
          height="6"
          rx="1"
          fill="currentColor"
          fillOpacity="0.15"
          stroke="none"
        />
        <path d="M2 8h8" strokeWidth="2.5" />
        <path d="M12 4.5v7" />
      </>,
    ),
  DivergingBar: () => svg(<path d="M8 2.5v11M8 4.5h5M8 8H4M8 11.5h3" />),
  Marimekko: () =>
    svg(
      <>
        <rect x="2" y="2.5" width="12" height="11" rx="1" />
        <path d="M7 2.5v11M11 2.5v11M2 8h5M7 6h4M11 10h3" />
      </>,
    ),
  SlopeChart: () =>
    svg(
      <>
        <path d="M3 3v10M13 3v10" strokeOpacity="0.35" />
        <path d="M3 10l10-6M3 5l10 5" />
      </>,
    ),
  BumpChart: () => svg(<path d="M2 4c3 0 3 8 6 8s3-8 6-8M2 12c3 0 3-8 6-8s3 8 6 8" />),
  Waterfall: () => svg(<path d="M2.5 13V9M6 9V5M9.5 5V7M13 7v6" strokeWidth="2" />),
  CalendarHeatmap: () =>
    svg(
      <>
        {[0, 1, 2, 3].flatMap((c) =>
          [0, 1, 2].map((r) => (
            <rect
              key={`${c}${r}`}
              x={2 + c * 3.2}
              y={3.5 + r * 3.2}
              width="2.4"
              height="2.4"
              rx="0.5"
              fill="currentColor"
              fillOpacity={0.2 + ((c + r) % 3) * 0.3}
              stroke="none"
            />
          )),
        )}
      </>,
    ),
  SmallMultiples: () =>
    svg(
      <>
        <path d="M2 7l2-2 2 1M9 7l2-3 3 2M2 14l2-1 2-2M9 14l2-2 3 1" />
      </>,
    ),
  BandChart: () =>
    svg(
      <>
        <path
          d="M2 9l4-4 4 2 4-3v6l-4 3-4-2-4 4Z"
          fill="currentColor"
          fillOpacity="0.2"
          stroke="none"
        />
        <path d="M2 11l4-3 4 2 4-3" />
      </>,
    ),
  ControlChart: () =>
    svg(
      <>
        <path d="M2 4h12M2 12h12" strokeOpacity="0.4" />
        <path d="M2 9l3-2 3 2 3-1 3 1" />
        {dot(11, 3)}
      </>,
    ),
  HorizonChart: () =>
    svg(
      <>
        <path d="M2 6l3-2 3 1 3-2 3 1v2H2Z" fill="currentColor" fillOpacity="0.5" stroke="none" />
        <path d="M2 13l3-2 3 1 3-3 3 2v2H2Z" fill="currentColor" fillOpacity="0.3" stroke="none" />
      </>,
    ),
  Timeline: () => svg(<path d="M2 4h6M5 8h7M3 12h5" strokeWidth="2.2" />),
  Gantt: () =>
    svg(
      <>
        <path d="M2 4h5M6 8h6M10 12h4" strokeWidth="2.2" />
        <path d="M7.5 4h1v3M12.5 8h.5v3" strokeWidth="1" />
      </>,
    ),
  Candlestick: () =>
    svg(
      <>
        <path d="M5 2v12M11 3v10" />
        <rect x="3.5" y="5" width="3" height="5" rx="0.5" fill="currentColor" stroke="none" />
        <rect x="9.5" y="6" width="3" height="4" rx="0.5" />
      </>,
    ),
  Histogram: () =>
    svg(<path d="M2 13h12M3 13V9h2.5v4M5.5 13V5H8v8M8 13V7h2.5v6M10.5 13v-3H13v3" />),
  BoxPlot: () =>
    svg(
      <>
        <rect x="5" y="5" width="6" height="6" rx="1" />
        <path d="M8 2v3M8 11v3M5 8h6" />
      </>,
    ),
  StripPlot: () =>
    svg(<>{[dot(3, 5), dot(5, 4), dot(7, 6), dot(4, 11), dot(8, 10), dot(11, 12), dot(12, 5)]}</>),
  EcdfChart: () => svg(<path d="M2 13h3v-3h3V6h3V3h3" />),
  ParetoChart: () =>
    svg(
      <>
        <path d="M2 14L14 2" strokeOpacity="0.35" />
        <path d="M2 14c1-6 4-10 12-12" />
      </>,
    ),
  Sankey: () =>
    svg(
      <>
        <path d="M2 4c6 0 6 6 12 6M2 12c6 0 6-6 12-6" />
        <path d="M2 2.5v3M2 10.5v3M14 4.5v3M14 8.5v3" strokeWidth="2" />
      </>,
    ),
  CohortTable: () =>
    svg(
      <>
        <path d="M2 3h12M2 6.5h9M2 10h6M2 13.5h3" strokeWidth="2.2" />
      </>,
    ),
  UpSetChart: () =>
    svg(
      <>
        <path d="M4 7V3M8 7V4.5M12 7V5.5" strokeWidth="2" />
        {[dot(4, 10), dot(4, 13), dot(8, 10), dot(12, 13)]}
        <path d="M4 10v3" />
      </>,
    ),
  ChoroplethMap: () =>
    svg(
      <path d="M6 2l4 1 1 3-1 3 1 3-3 2-3-1-1-3 1-3-1-3Z" fill="currentColor" fillOpacity="0.25" />,
    ),
  SymbolMap: () =>
    svg(
      <>
        <path d="M6 2l4 1 1 3-1 3 1 3-3 2-3-1-1-3 1-3-1-3Z" strokeOpacity="0.4" />
        {[dot(8, 5, 1.6), dot(7, 10, 1.1), dot(9.5, 8, 0.9)]}
      </>,
    ),
  TileMap: () =>
    svg(
      <>
        <rect x="7" y="2" width="3.2" height="3.2" rx="0.6" />
        <rect
          x="4"
          y="5.6"
          width="3.2"
          height="3.2"
          rx="0.6"
          fill="currentColor"
          fillOpacity="0.4"
        />
        <rect x="7.6" y="5.6" width="3.2" height="3.2" rx="0.6" />
        <rect
          x="5.8"
          y="9.2"
          width="3.2"
          height="3.2"
          rx="0.6"
          fill="currentColor"
          fillOpacity="0.7"
        />
      </>,
    ),
  StateTimeline: () =>
    svg(
      <>
        <path d="M2 4.5h5" strokeWidth="2.5" />
        <path d="M7.5 4.5h2" strokeWidth="2.5" strokeOpacity="0.4" />
        <path d="M10 4.5h4M2 10.5h8" strokeWidth="2.5" />
        <path d="M10.5 10.5h3.5" strokeWidth="2.5" strokeOpacity="0.4" />
      </>,
    ),
  PivotTable: () =>
    svg(
      <>
        <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
        <path d="M2 6h12M6 2.5v11M2 13.5h12" />
        <path d="M10 6v7.5" strokeOpacity="0.4" />
      </>,
    ),
}

export { CHART_GROUPS } from '../../runtime/catalog.js'
