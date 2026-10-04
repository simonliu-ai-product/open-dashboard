---
name: connect-database
description: Use this skill when the user wants to connect this open-dashboard workspace to a database or data warehouse — "connect to our Postgres", "use this SQLite file", "here is the SQL Server connection string", "hook up BigQuery / Snowflake / ClickHouse / Oracle", "query these Parquet files", "add a datasource", or when `open-dashboard sources` reports a failure. Covers SQLite, PostgreSQL (and Supabase, Neon, RDS, Redshift, CockroachDB…), MySQL (and MariaDB, PlanetScale, TiDB…), SQL Server / Azure SQL, Oracle, DuckDB / Parquet / CSV, ClickHouse, BigQuery and Snowflake. Do NOT use for writing dashboards — that is `create-dashboard`.
---

# Connect a database

You edit `open-dashboard.config.ts` and `.env`, and install a driver if one is
needed. Nothing else.

```bash
pnpm exec open-dashboard drivers     # every supported type, its package, how it stays read-only
```

Per-engine config, `.env` format, read-only grants and common errors:
[references/engines.md](references/engines.md).

## Step 1 — Find out what they have

Ask only for what you cannot see. One `AskUserQuestion` call at most:

- **Engine** — map the product to a `type`:

  | They say | `type` |
  | --- | --- |
  | Postgres, Supabase, Neon, RDS/Aurora Postgres, Cloud SQL, AlloyDB, Redshift, CockroachDB, TimescaleDB | `postgres` |
  | MySQL, MariaDB, PlanetScale, TiDB, RDS/Aurora MySQL | `mysql` |
  | SQL Server, Azure SQL, RDS for SQL Server | `mssql` |
  | Oracle, Autonomous Database | `oracle` |
  | a `.db` / `.sqlite` file | `sqlite` |
  | a `.duckdb` file, or Parquet / CSV / JSON files | `duckdb` |
  | ClickHouse, ClickHouse Cloud | `clickhouse` |
  | BigQuery | `bigquery` |
  | Snowflake | `snowflake` |
  | a JSON HTTP API (REST, open data portals) | `http` |
  | an MCP server (its read-only tools) | `mcp` |

  MongoDB, Elasticsearch, DynamoDB and other non-SQL stores have no driver of
  their own. If they expose a JSON HTTP API or an MCP server, use `http` /
  `mcp`; otherwise say so plainly and suggest a SQL layer they may already have
  (a warehouse export, Athena, DuckDB over an export).
- **Where** — a file path, a connection string, or (BigQuery / Snowflake) the
  project / account identifiers.
- **A name** — short, lowercase: `shop`, `warehouse`, `billing`. It appears in
  `-- source:` lines, so it should say which database it is.

**Never ask the user to paste a password into the chat if they can avoid it.**
Tell them to put the secret in `.env` themselves, and you reference the
variable. If they already pasted it, write it to `.env` and do not repeat it back.

## Step 2 — Recommend a read-only login

open-dashboard keeps every query read-only on every engine (the per-engine
mechanism is in `open-dashboard drivers`). Still give the user the read-only
grant for their engine from [references/engines.md](references/engines.md) —
it is the real protection, it stops a slow dashboard query holding write locks,
and on SQL Server and Snowflake (no read-only transactions) it matters most.
For production, suggest a replica.

## Step 3 — Write the config

```ts
// open-dashboard.config.ts
import type { OpenDashboardConfig } from '@open-dashboard/core'

export default {
  datasources: {
    app: { type: 'postgres', url: process.env.APP_DATABASE_URL ?? '' },
    erp: { type: 'mssql', url: process.env.ERP_MSSQL_URL ?? '' },
    events: { type: 'clickhouse', url: process.env.CLICKHOUSE_URL ?? '' },
  },
  defaultSource: 'app',
} satisfies OpenDashboardConfig
```

- Secrets come from `process.env`; `.env` is loaded for you and reloads on save.
- `defaultSource` is used by queries without a `-- source:` line. With one
  datasource it is implied.
- File paths (SQLite, DuckDB, key files) are relative to the workspace root.
- Keep the file plain: `import type` and `satisfies` only — it is loaded by
  Node's own TypeScript support, which does not run enums or decorators.
- Check `.gitignore` contains `.env`. Add it if not.

## Step 4 — Install the driver

```bash
pnpm add pg | mysql2 | mssql | oracledb | @duckdb/node-api | @clickhouse/client | @google-cloud/bigquery | snowflake-sdk
```

SQLite needs nothing (built into Node 22.13+).

## Step 5 — Prove it works

```bash
pnpm exec open-dashboard sources          # ✓ or ✗ with the driver's error
pnpm exec open-dashboard schema <name>    # every table, column, key, row count
pnpm exec open-dashboard query --source <name> "SELECT 1 AS ok"
```

Fix failures with the table in [references/engines.md](references/engines.md).
The dev server picks up config and `.env` changes without a restart.

## Step 6 — Report

Summarise the schema in a few lines: the main tables, how they join, which
columns hold time, money and status, and the date range of the data. Name the
SQL dialect — dashboards for this source must be written in it (see
`dashboard-authoring` → `references/sql-dialects.md`). Then write
`databases/<name>/database.md` with what you found (the `document-database`
skill), and offer what to build: "I can make you a dashboard of X, Y, Z —
`/create-dashboard`."
