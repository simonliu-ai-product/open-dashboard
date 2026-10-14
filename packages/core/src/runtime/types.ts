import type { ColumnInfo, ParamValue, Row } from '../config.js'

export interface SavedView {
  name: string
  filters: Record<string, string | null>
}

export interface DashboardMeta {
  title: string
  description?: string
  /** Auto-refresh interval: '30s', '1m', '5m', '1h'. Omit for manual refresh. */
  refresh?: string
  /** BCP 47 locale for numbers and dates. Default 'en-US'. */
  locale?: string
  /** ISO 4217 code used by the 'currency' formats. Default 'USD'. */
  currency?: string
  /** A theme in `themes/<id>.json`. Default: the workspace's `theme`, else the built-in look. */
  theme?: string
  /** Named filter presets readers can switch between with one click. */
  views?: SavedView[]
  createdAt?: string
}

export interface QueryAlertResult {
  rule: string
  column: string
  op: '>' | '>=' | '<' | '<=' | '==' | '!='
  threshold: number
  actual: number | null
  triggered: boolean
  message?: string
}

export interface QueryRun {
  query: {
    name: string
    source: string
    sql: string
    file: string
    line: number
    uses?: string[]
  }
  params: Record<string, ParamValue>
  result: { columns: ColumnInfo[]; rows: Row[]; truncated: boolean; elapsedMs: number }
  alerts?: QueryAlertResult[]
  ranAt?: string
  cached?: boolean
}

export type NamedFormat =
  | 'number'
  | 'integer'
  | 'decimal'
  | 'compact'
  | 'currency'
  | 'currencyCompact'
  | 'percent'
  | 'date'
  | 'month'
  | 'text'

export type Format = NamedFormat | Intl.NumberFormatOptions

export interface PanelInfo {
  title: string
  component: string
  query?: string
}
