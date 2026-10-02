import type { ColumnInfo, ParamValue, Row } from '../config.js'

export interface DashboardMeta {
  title: string
  description?: string
  /** Auto-refresh interval: '30s', '1m', '5m', '1h'. Omit for manual refresh. */
  refresh?: string
  /** BCP 47 locale for numbers and dates. Default 'en-US'. */
  locale?: string
  /** ISO 4217 code used by the 'currency' formats. Default 'USD'. */
  currency?: string
  createdAt?: string
}

export interface QueryRun {
  query: { name: string; source: string; sql: string; file: string; line: number }
  params: Record<string, ParamValue>
  result: { columns: ColumnInfo[]; rows: Row[]; truncated: boolean; elapsedMs: number }
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
