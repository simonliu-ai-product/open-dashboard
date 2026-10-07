export interface SqliteSource {
  type: 'sqlite'
  /** Path to the database file, relative to the workspace root. */
  file: string
}

export interface PostgresSource {
  type: 'postgres'
  /** A connection string, usually read from `.env`: `process.env.DATABASE_URL`. */
  url: string
  /** Passed through to `pg.Pool` — ssl, application_name, and so on. */
  options?: Record<string, unknown>
}

export interface MysqlSource {
  type: 'mysql'
  url: string
  options?: Record<string, unknown>
}

export interface MssqlSource {
  type: 'mssql'
  /** `mssql://user:pass@host:1433/db?encrypt=true` or an ADO.NET string `Server=…;Database=…;User Id=…;Password=…`. */
  url: string
  /** Passed through to `mssql.ConnectionPool`. */
  options?: Record<string, unknown>
}

export interface OracleSource {
  type: 'oracle'
  /** `oracle://user:pass@host:1521/SERVICE_NAME`. Or give user, password and connectString. */
  url?: string
  user?: string
  password?: string
  /** Easy Connect (`host:1521/service`) or a TNS alias. */
  connectString?: string
  /** List and query another user's tables. Default: the connected user's own. */
  schema?: string
  options?: Record<string, unknown>
}

export interface DuckdbSource {
  type: 'duckdb'
  /** A .duckdb file relative to the workspace, or ':memory:' (the default) to query Parquet/CSV files in place. */
  file?: string
  /** Statements run once when the connection opens — e.g. `CREATE VIEW sales AS SELECT * FROM 'data/sales.parquet'`. */
  init?: string[]
}

export interface ClickhouseSource {
  type: 'clickhouse'
  /** `https://user:pass@host:8443/database`. */
  url: string
  /** Passed through to `@clickhouse/client`'s createClient. */
  options?: Record<string, unknown>
}

export interface BigquerySource {
  type: 'bigquery'
  projectId: string
  /** Default dataset, so queries can say `orders` instead of `project.dataset.orders`. */
  dataset?: string
  /** Datasets to list in the schema. Default: `dataset`, else every dataset (first 20). */
  datasets?: string[]
  location?: string
  /** A service-account key file. Omit to use Application Default Credentials. */
  keyFilename?: string
  credentials?: Record<string, unknown>
  /** Refuse any query that would scan more than this many bytes. Default 10 GiB. */
  maximumBytesBilled?: number
  options?: Record<string, unknown>
}

export interface SnowflakeSource {
  type: 'snowflake'
  /** Account identifier, e.g. `myorg-myaccount`. */
  account: string
  username: string
  password?: string
  /** A PEM private key file for key-pair auth, relative to the workspace. */
  privateKeyPath?: string
  authenticator?: string
  warehouse?: string
  database?: string
  schema?: string
  role?: string
  options?: Record<string, unknown>
}

/**
 * One table of a JSON source. Its rows are an array in the response: `rows` is
 * the dotted path to it (`data`, `result.items`); without one, the response
 * itself when it is an array, else its first array property. Nested values
 * arrive as JSON text — read them in SQL with `json_extract` / `json_each`.
 */
export interface JsonTable {
  rows?: string
  /** How long a fetched result is reused before fetching again. Default '30s'. */
  cache?: string
}

export interface HttpTable extends JsonTable {
  /** Absolute, or relative to the source's `baseUrl`. `:name` is replaced by that query parameter. */
  url: string
}

/**
 * A JSON HTTP API, as tables. Only GET, only the URLs written here: the page
 * cannot point the server anywhere else.
 */
export interface HttpSource {
  type: 'http'
  baseUrl?: string
  /** Sent with every request — put tokens in `.env` and reference them here. */
  headers?: Record<string, string>
  tables: Record<string, HttpTable>
}

export interface McpTable extends JsonTable {
  /** The tool to call. It must be annotated read-only — see `McpSource.allowUnannotated`. */
  tool: string
  /** Its arguments. A string `:name` is replaced by that query parameter. */
  args?: Record<string, unknown>
}

/**
 * An MCP server's read-only tools, as tables. Remote (`url`, streamable HTTP)
 * or local (`command`, stdio).
 */
export interface McpSource {
  type: 'mcp'
  url?: string
  headers?: Record<string, string>
  command?: string
  args?: string[]
  env?: Record<string, string>
  tables: Record<string, McpTable>
  /**
   * Call tools that do not say whether they write. Default false: only tools
   * annotated `readOnlyHint: true` are called, and a `destructiveHint: true`
   * tool never is.
   */
  allowUnannotated?: boolean
}

export interface FileTable {
  /**
   * A file under the workspace, or a glob (`results/**\/*.json`): every
   * matching file is stacked into the table, with its path in `_file`.
   */
  file: string
  /** JSON only: where the rows are — a dot path such as `data.items`. Default: the file itself, or its first array. */
  rows?: string
  /** How long a read is reused. Default '30s'; an edited file is read again at once either way. */
  cache?: string
}

/** Local JSON or JSON Lines (`.jsonl`, `.ndjson`) files, as tables. */
export interface JsonFileSource {
  type: 'json'
  tables: Record<string, FileTable>
}

/** Local CSV (or `.tsv`) files with a header row, as tables. */
export interface CsvSource {
  type: 'csv'
  tables: Record<string, FileTable>
  /** Default ',' — or a tab for `.tsv`. */
  delimiter?: string
}

export type DatasourceConfig =
  | SqliteSource
  | PostgresSource
  | MysqlSource
  | MssqlSource
  | OracleSource
  | DuckdbSource
  | ClickhouseSource
  | BigquerySource
  | SnowflakeSource
  | HttpSource
  | McpSource
  | JsonFileSource
  | CsvSource
export type DatasourceType = DatasourceConfig['type']

/**
 * An optional chat assistant on dashboard pages, answering from what the page
 * shows. Off unless configured; the key stays on the server.
 */
export interface AssistantConfig {
  /** 'gemini': Google's OpenAI-compatible endpoint. 'openai': any OpenAI-compatible API (OpenAI, Ollama, vLLM, LM Studio…). */
  provider: 'gemini' | 'openai'
  /** The model name your provider uses. */
  model: string
  /** From `.env`. Optional only for a local `openai` server with `baseUrl`. */
  apiKey?: string
  /** Override the provider's endpoint, e.g. `http://localhost:11434/v1` for Ollama. */
  baseUrl?: string
  /** Rows per query sent with a question. Default 200. */
  maxRows?: number
  /**
   * How long the model thinks before it answers: 'low' | 'medium' | 'high'. Usually
   * `process.env.ASSISTANT_REASONING_EFFORT`; any other value counts as unset. Gemini:
   * default 'medium'. 'openai': sent as `reasoning_effort` only when set — leave it
   * out for a model that does not reason.
   */
  reasoningEffort?: string
}

/**
 * A command that refreshes a datasource — fetches an API into SQLite, exports
 * a CSV. It runs in the workspace root with `.env` loaded. The page can start
 * one by its name; it never sends a command.
 */
export interface CollectorConfig {
  /** A string runs in a shell; an array runs the program directly. */
  run: string | string[]
  /** Run on a schedule while `open-dashboard dev` runs: '15m', '1h', '1d'. Omit to run only when asked. */
  every?: string
  /** The datasource it writes: its page shows the last run, with a button to run it now. */
  source?: string
  /** Stopped after this long. Default '10m'. */
  timeout?: string
}

export interface OpenDashboardConfig {
  /** Where dashboards live. Default `dashboards`. */
  dashboardsDir?: string
  /** Where custom charts live (`charts/<id>/index.tsx`). Default `charts`. */
  chartsDir?: string
  datasources: Record<string, DatasourceConfig>
  /** The source a query uses when it names none. Defaults to the only one, if there is only one. */
  defaultSource?: string
  /** Rows returned per query before the result is marked truncated. Default 5000. */
  maxRows?: number
  /** Per-query timeout, where the driver supports one. Default 15000. */
  timeoutMs?: number
  /**
   * How long a query's result is reused for everyone viewing it: '30s', '5m',
   * '1h'. Default '30s'; `false` or 'off' runs every request. A query can set
   * its own with `-- cache:`, and the refresh button always runs fresh.
   */
  cache?: string | false
  /** The theme in `themes/<id>.json` for dashboards that do not pick one with `meta.theme`. */
  theme?: string
  assistant?: AssistantConfig
  /** Commands that refresh datasources, by name: `open-dashboard collect <name>`. */
  collectors?: Record<string, CollectorConfig>
}

export type ColumnType = 'number' | 'string' | 'date' | 'boolean' | 'unknown'

export interface ColumnInfo {
  name: string
  type: ColumnType
}

export type Row = Record<string, unknown>

export interface QueryResult {
  columns: ColumnInfo[]
  rows: Row[]
  truncated: boolean
  elapsedMs: number
}

export type ParamValue = string | number | boolean | null

export interface TableInfo {
  name: string
  schema?: string
  kind: 'table' | 'view'
  rowCount?: number
  columns: { name: string; type: string; nullable: boolean; primaryKey: boolean }[]
  foreignKeys: { column: string; table: string; references: string }[]
}

export interface SchemaInfo {
  source: string
  type: DatasourceType
  tables: TableInfo[]
}
