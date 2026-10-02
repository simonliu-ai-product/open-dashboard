const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const SunIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </svg>
)

export const MoonIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
  </svg>
)

export const AutoIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5v11" />
    <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" stroke="none" />
  </svg>
)

export const GlobeIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14C6.3 12.2 5.5 10.2 5.5 8S6.3 3.8 8 2Z" />
  </svg>
)

export const ChevronIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M4.5 10l3.5-3.5 3.5 3.5" />
  </svg>
)

export const CheckIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
)

export const CopyIcon = () => (
  <svg {...base} aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
)

export const ArrowIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M6 3.5L10.5 8 6 12.5" />
  </svg>
)

export const EyeIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
)

export const PencilIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M10.5 2.5l3 3L6 13H3v-3Z" />
    <path d="M9 4l3 3" />
  </svg>
)

export const LinkIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8" />
    <path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />
  </svg>
)

export const RefreshIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.5 2.5v3h-3" />
  </svg>
)

export const UndoIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M5.5 3.5l-3 3 3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8h-2" />
  </svg>
)

export const LineChartIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M2 12l4-4 3 2 5-6" />
  </svg>
)

export const AreaChartIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M2 13V10l4-4 3 2 5-5v10Z" fill="currentColor" fillOpacity="0.25" />
  </svg>
)

export const BarChartIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M3 13V8M8 13V3M13 13V6" />
  </svg>
)

export const PieChartIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5V8l4.5 3" />
  </svg>
)

export const TableIcon = () => (
  <svg {...base} aria-hidden="true">
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M2 6.5h12M2 10h12M6 6.5V13" />
  </svg>
)

export const StatIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M3 11.5h3.5M3 8.5h10M3 5h6" />
  </svg>
)

export const ScatterIcon = () => (
  <svg {...base} aria-hidden="true">
    <circle cx="4" cy="11" r="1.4" fill="currentColor" />
    <circle cx="7.5" cy="7" r="1.4" fill="currentColor" />
    <circle cx="11" cy="9" r="1.4" fill="currentColor" />
    <circle cx="12.5" cy="4" r="1.4" fill="currentColor" />
  </svg>
)

export const HeatmapIcon = () => (
  <svg {...base} aria-hidden="true">
    <rect x="2.5" y="2.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.85" />
    <rect x="8.5" y="2.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.35" />
    <rect x="2.5" y="8.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.2" />
    <rect x="8.5" y="8.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.6" />
  </svg>
)

export const FunnelIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M2.5 3.5h11M4.5 8h7M6.5 12.5h3" strokeWidth="2" />
  </svg>
)

export const GaugeIcon = () => (
  <svg {...base} aria-hidden="true">
    <path d="M2.5 11.5a5.5 5.5 0 0 1 11 0" />
    <path d="M8 11.5l2.5-3.5" />
  </svg>
)

export const TreemapIcon = () => (
  <svg {...base} aria-hidden="true">
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M8.5 2.5v11M8.5 8H14M5 8v5.5" />
  </svg>
)
