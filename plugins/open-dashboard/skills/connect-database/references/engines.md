# Engines

Every engine: install the package, put secrets in `.env`, verify with
`open-dashboard sources` and `open-dashboard schema <name>`.

## PostgreSQL — `postgres` (`pnpm add pg`)

```ts
app: { type: 'postgres', url: process.env.APP_DATABASE_URL ?? '' }
```
```bash
APP_DATABASE_URL=postgres://reader:…@db.example.com:5432/app?sslmode=require
```
- Same type for Supabase (use the pooler URL, port 6543, or direct 5432), Neon,
  RDS/Aurora, Cloud SQL, AlloyDB, CockroachDB, TimescaleDB, Redshift (port 5439).
- `options` goes to `pg.Pool`: `options: { ssl: { rejectUnauthorized: false } }`.
- Read-only role:
  ```sql
  CREATE ROLE dashboard_reader LOGIN PASSWORD '…';
  GRANT CONNECT ON DATABASE app TO dashboard_reader;
  GRANT USAGE ON SCHEMA public TO dashboard_reader;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_reader;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_reader;
  ```

## MySQL — `mysql` (`pnpm add mysql2`)

```ts
shop: { type: 'mysql', url: process.env.SHOP_MYSQL_URL ?? '' }
```
```bash
SHOP_MYSQL_URL=mysql://reader:…@mysql.example.com:3306/shop
```
- Same type for MariaDB, PlanetScale (`?ssl={"rejectUnauthorized":true}`), TiDB, RDS/Aurora.
- Read-only user: `CREATE USER 'reader'@'%' IDENTIFIED BY '…'; GRANT SELECT ON shop.* TO 'reader'@'%';`

## SQL Server — `mssql` (`pnpm add mssql`)

```ts
erp: { type: 'mssql', url: process.env.ERP_MSSQL_URL ?? '' }
```
```bash
# URL form …
ERP_MSSQL_URL=mssql://reader:…@sql.example.com:1433/erp?encrypt=true
# … or an ADO.NET string
ERP_MSSQL_URL=Server=sql.example.com,1433;Database=erp;User Id=reader;Password=…;Encrypt=true
```
- Azure SQL: `encrypt=true` (required). Local / self-signed: add
  `&trustServerCertificate=true`.
- No read-only transaction exists in SQL Server: queries are checked to be a
  single SELECT and are rolled back. Use a reader login:
  ```sql
  CREATE LOGIN dashboard_reader WITH PASSWORD = '…';
  USE erp; CREATE USER dashboard_reader FOR LOGIN dashboard_reader;
  ALTER ROLE db_datareader ADD MEMBER dashboard_reader;
  ```

## Oracle — `oracle` (`pnpm add oracledb`)

```ts
ledger: { type: 'oracle', url: process.env.ORACLE_URL }
// or: { type: 'oracle', user: 'READER', password: process.env.ORACLE_PASSWORD, connectString: 'db.example.com:1521/ORCLPDB1' }
```
```bash
ORACLE_URL=oracle://reader:…@db.example.com:1521/ORCLPDB1
```
- The path is the **service name**, not the SID.
- Uses the pure-JavaScript thin mode — no Instant Client needed. Autonomous
  Database with a wallet: pass `options: { configDir, walletLocation, walletPassword }`.
- `schema: 'SALES'` lists another user's tables (needs SELECT grants on them).
- Read-only user: `CREATE USER reader IDENTIFIED BY "…"; GRANT CREATE SESSION TO reader; GRANT SELECT ON sales.orders TO reader;` (or `GRANT READ ANY TABLE` on a non-production database).

## DuckDB, Parquet, CSV — `duckdb` (`pnpm add @duckdb/node-api`)

```ts
// a database file, opened read-only
lake: { type: 'duckdb', file: 'data/warehouse.duckdb' }

// files queried in place — no import step
files: {
  type: 'duckdb',
  init: [
    "CREATE VIEW orders AS SELECT * FROM 'data/orders/*.parquet'",
    "CREATE VIEW customers AS SELECT * FROM read_csv_auto('data/customers.csv')",
  ],
}
```
- Paths inside SQL resolve against the workspace root.
- `init` runs once per connection — the place for views over files. Dashboard
  queries themselves cannot COPY, ATTACH, INSTALL or SET.
- Remote files (`s3://`, `https://`) need the httpfs extension; install it in
  `init`: `"INSTALL httpfs", "LOAD httpfs"`, plus credentials via `CREATE SECRET`.

## ClickHouse — `clickhouse` (`pnpm add @clickhouse/client`)

```ts
events: { type: 'clickhouse', url: process.env.CLICKHOUSE_URL ?? '' }
```
```bash
CLICKHOUSE_URL=https://reader:…@abc123.eu-central-1.aws.clickhouse.cloud:8443/default
```
- HTTP(S) interface: 8123 / 8443, not the native 9000.
- Every request runs with `readonly = 2`. A dedicated user:
  `CREATE USER reader IDENTIFIED BY '…' SETTINGS readonly = 2; GRANT SELECT ON default.* TO reader;`

## BigQuery — `bigquery` (`pnpm add @google-cloud/bigquery`)

```ts
analytics: {
  type: 'bigquery',
  projectId: 'my-project',
  dataset: 'analytics',                       // default dataset for unqualified names
  location: 'asia-east1',                     // where the dataset lives
  keyFilename: 'secrets/bigquery-reader.json', // omit to use `gcloud auth application-default login`
  maximumBytesBilled: 5 * 1024 ** 3,          // default 10 GiB
}
```
- Every query is dry-run first: it must be a SELECT and must scan under
  `maximumBytesBilled`, which is also set on the job. A query over the cap fails
  with the scan size — fix the query (partition filter, fewer columns) before
  raising the cap, and tell the user what it would cost.
- Service account roles: **BigQuery Data Viewer** on the dataset and **BigQuery
  Job User** on the project. Key files go in a git-ignored folder.

## Snowflake — `snowflake` (`pnpm add snowflake-sdk`)

```ts
warehouse: {
  type: 'snowflake',
  account: process.env.SNOWFLAKE_ACCOUNT ?? '',   // e.g. myorg-myaccount
  username: process.env.SNOWFLAKE_USER ?? '',
  password: process.env.SNOWFLAKE_PASSWORD,       // or privateKeyPath: 'secrets/rsa_key.p8'
  warehouse: 'REPORTING_WH',
  database: 'ANALYTICS',
  schema: 'PUBLIC',
  role: 'DASHBOARD_READER',
}
```
- No read-only transactions in Snowflake: queries are checked to be a single
  SELECT. The role is the real protection:
  ```sql
  CREATE ROLE dashboard_reader;
  GRANT USAGE ON WAREHOUSE reporting_wh TO ROLE dashboard_reader;
  GRANT USAGE ON DATABASE analytics TO ROLE dashboard_reader;
  GRANT USAGE ON ALL SCHEMAS IN DATABASE analytics TO ROLE dashboard_reader;
  GRANT SELECT ON ALL TABLES IN DATABASE analytics TO ROLE dashboard_reader;
  GRANT SELECT ON FUTURE TABLES IN DATABASE analytics TO ROLE dashboard_reader;
  ```
- Use a small warehouse with auto-suspend; dashboards refresh on a timer.
- Unquoted names come back upper-case and are folded to lower case, so
  `AS revenue` is `revenue` in panels.

## SQLite — `sqlite` (built in)

```ts
local: { type: 'sqlite', file: 'data/app.db' }
```
- Opened read-only. If the file is replaced (a fresh export), it is reopened.

## HTTP API — `http` (built in)

A JSON API, one table per endpoint. Only GET, only these URLs.

```ts
twse: {
  type: 'http',
  baseUrl: 'https://openapi.twse.com.tw/v1',
  headers: { Authorization: `Bearer ${process.env.TWSE_TOKEN}` }, // if it needs one
  tables: {
    market_daily: { url: '/exchangeReport/FMTQIK' },
    stock_day: { url: '/exchangeReport/STOCK_DAY_ALL', cache: '10m' },
    orders: { url: '/orders?since=:from', rows: 'data.items' },
  },
},
```
- `rows`: dotted path to the array in the response; default the response
  itself, or its first array property.
- `:name` in a URL is filled from the query's parameters, URL-encoded.
- `cache` (default `30s`): one fetch serves every panel reading the table.
- Values come as the API sends them — often **numbers as strings**: `CAST` in
  SQL. Nested objects arrive as JSON text: `json_extract`, `json_each`.
- Fetch a sample first to see the shape: `curl -s <url> | head -c 600`.

## MCP — `mcp` (built in)

An MCP server's tools, one table per tool call. Remote (`url`, streamable HTTP)
or local (`command` + `args`, stdio).

```ts
hub: {
  type: 'mcp',
  url: 'https://example.com/mcp/',
  headers: { Authorization: `Bearer ${process.env.HUB_TOKEN}` },
  tables: {
    reservoir: { tool: 'tw_rt_reservoir_live', args: { name: ':reservoir' }, rows: 'data' },
  },
},
local: { type: 'mcp', command: 'npx', args: ['-y', 'some-mcp-server'], tables: { … } },
```
- Only tools annotated **`readOnlyHint: true`** are called; `destructiveHint`
  tools never are. `allowUnannotated: true` lets tools that say nothing be
  called — only when the user confirms they do not write. Tell the user that
  MCP's read-only guarantee is the tool's own word, weaker than a database's.
- The tool's result must be JSON: structured content, or a text block that
  parses. `rows` points at the array inside it.
- A string `:name` in `args` is filled from the query's parameters (a
  `<Select>` value, `:from`).
- List the tools and their annotations before choosing: call `tools/list`
  (or read the server's docs).

## When `sources` shows ✗

| Error | Cause |
| --- | --- |
| `url is empty — is it set in .env?` | the variable is missing or misspelled |
| `needs the "…" package` | run the `pnpm add` for that engine |
| `ECONNREFUSED` / `ETIMEDOUT` / `getaddrinfo ENOTFOUND` | wrong host or port, firewall, or an IP allowlist (cloud databases usually have one) |
| `password authentication failed` / `Login failed` / `ORA-01017` | credentials — ask the user to fix `.env` |
| `self-signed certificate` / `unable to verify` | Postgres: `options: { ssl: { rejectUnauthorized: false } }`; SQL Server: `trustServerCertificate=true` |
| `ORA-12514` | the URL path is not a registered service name |
| BigQuery `Could not load the default credentials` | set `keyFilename`, or run `gcloud auth application-default login` |
| Snowflake `Incorrect username or password` / `IP … is not allowed` | credentials, or the account's network policy |
