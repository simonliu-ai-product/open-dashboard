import type { DatasourceType } from '../config.js'

export interface DriverInfo {
  type: DatasourceType
  label: string
  /** The npm package the workspace installs, or undefined when built in. */
  package?: string
  /** Other products that speak this protocol and use this type. */
  compatible: string[]
  /** How queries are kept read-only, in one line. */
  readOnly: string
  example: string
}

export const DRIVERS: DriverInfo[] = [
  {
    type: 'sqlite',
    label: 'SQLite',
    compatible: [],
    readOnly: 'file opened read-only with query_only',
    example: "{ type: 'sqlite', file: 'data/app.db' }",
  },
  {
    type: 'postgres',
    label: 'PostgreSQL',
    package: 'pg',
    compatible: [
      'Supabase',
      'Neon',
      'Amazon RDS/Aurora',
      'Cloud SQL',
      'Redshift',
      'CockroachDB',
      'TimescaleDB',
      'AlloyDB',
    ],
    readOnly: 'BEGIN READ ONLY … ROLLBACK, statement_timeout',
    example: "{ type: 'postgres', url: process.env.DATABASE_URL ?? '' }",
  },
  {
    type: 'mysql',
    label: 'MySQL',
    package: 'mysql2',
    compatible: ['MariaDB', 'PlanetScale', 'TiDB', 'Amazon RDS/Aurora', 'Cloud SQL'],
    readOnly: 'SELECT-only check plus START TRANSACTION READ ONLY (DDL would commit past it)',
    example: "{ type: 'mysql', url: process.env.MYSQL_URL ?? '' }",
  },
  {
    type: 'mssql',
    label: 'SQL Server',
    package: 'mssql',
    compatible: ['Azure SQL Database', 'Azure SQL Managed Instance', 'Amazon RDS for SQL Server'],
    readOnly: 'SELECT-only check, every query rolled back',
    example: "{ type: 'mssql', url: process.env.MSSQL_URL ?? '' }",
  },
  {
    type: 'oracle',
    label: 'Oracle',
    package: 'oracledb',
    compatible: ['Oracle Autonomous Database', 'Amazon RDS for Oracle'],
    readOnly: 'SET TRANSACTION READ ONLY plus SELECT-only check',
    example: "{ type: 'oracle', url: process.env.ORACLE_URL }",
  },
  {
    type: 'duckdb',
    label: 'DuckDB',
    package: '@duckdb/node-api',
    compatible: ['Parquet / CSV / JSON files', 'MotherDuck'],
    readOnly: 'file opened READ_ONLY plus SELECT-only check',
    example: "{ type: 'duckdb', file: 'data/warehouse.duckdb' }",
  },
  {
    type: 'clickhouse',
    label: 'ClickHouse',
    package: '@clickhouse/client',
    compatible: ['ClickHouse Cloud'],
    readOnly: 'readonly = 2 on every request',
    example: "{ type: 'clickhouse', url: process.env.CLICKHOUSE_URL ?? '' }",
  },
  {
    type: 'bigquery',
    label: 'BigQuery',
    package: '@google-cloud/bigquery',
    compatible: [],
    readOnly: 'dry run must be SELECT; maximumBytesBilled caps cost',
    example: "{ type: 'bigquery', projectId: 'my-project', dataset: 'analytics' }",
  },
  {
    type: 'snowflake',
    label: 'Snowflake',
    package: 'snowflake-sdk',
    compatible: [],
    readOnly: 'SELECT-only check; use a role granted only SELECT',
    example:
      "{ type: 'snowflake', account: process.env.SNOWFLAKE_ACCOUNT ?? '', username: process.env.SNOWFLAKE_USER ?? '', password: process.env.SNOWFLAKE_PASSWORD, warehouse: 'ANALYTICS_WH', database: 'PROD', role: 'REPORTER' }",
  },
  {
    type: 'http',
    label: 'HTTP API',
    compatible: ['REST and other JSON APIs'],
    readOnly:
      'GET only, to URLs written in the config; SQL runs over the response in a scratch SQLite',
    example:
      "{ type: 'http', baseUrl: 'https://openapi.twse.com.tw/v1', tables: { market: { url: '/exchangeReport/FMTQIK' } } }",
  },
  {
    type: 'mcp',
    label: 'MCP',
    compatible: ['remote (streamable HTTP) and local (stdio) MCP servers'],
    readOnly:
      'only tools annotated readOnlyHint (never destructiveHint); SQL runs over their JSON in a scratch SQLite',
    example:
      "{ type: 'mcp', url: 'https://example.com/mcp/', headers: { Authorization: process.env.MCP_AUTHORIZATION ?? '' }, tables: { items: { tool: 'list_items', rows: 'data' } } }",
  },
]

export function driverFor(type: string): DriverInfo | undefined {
  return DRIVERS.find((driver) => driver.type === type)
}
