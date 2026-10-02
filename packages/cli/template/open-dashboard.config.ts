import type { OpenDashboardConfig } from '@open-dashboard/core'

export default {
  datasources: {
    // Ask your agent: /connect-database. Or see `pnpm exec open-dashboard drivers`.
    // app: { type: 'postgres', url: process.env.APP_DATABASE_URL ?? '' },
    // erp: { type: 'mssql', url: process.env.ERP_MSSQL_URL ?? '' },
    // events: { type: 'clickhouse', url: process.env.CLICKHOUSE_URL ?? '' },
    // lake: { type: 'duckdb', init: ["CREATE VIEW orders AS SELECT * FROM 'data/orders.parquet'"] },
    // analytics: { type: 'bigquery', projectId: 'my-project', dataset: 'analytics' },
  },
} satisfies OpenDashboardConfig
