# This is an open-dashboard workspace

The user describes the dashboard they want; you write it. Each dashboard is a
folder `dashboards/<id>/` with named SQL queries in `*.sql` and a layout in
`index.tsx`. Each database has notes in `databases/<source>/database.md` —
what its tables and columns mean; read them before writing SQL. Charts no
built-in panel draws live in `charts/<id>/` (`defineChart`), and themes —
colours, fonts, corner radius — in `themes/<id>.json`, picked by a dashboard's
`meta.theme`. If an assistant is configured, `assistant.md` (and `dashboards/<id>/assistant.md`) holds its instructions. The dev server (`pnpm dev`, http://localhost:5473) shows it live
and hot-reloads as you edit.

## Skills

- `/connect-database` — add a datasource: Postgres, MySQL, SQL Server, Oracle, SQLite, DuckDB/Parquet, ClickHouse, BigQuery, Snowflake
- `/document-database` — write `databases/<source>/database.md`: what tables and columns mean
- `/create-dashboard` — draft a dashboard end to end
- `/dashboard-authoring` — the reference: query files, filters, panels, formats
- `/create-chart` — a chart no built-in panel draws, written once under `charts/`
- `/create-theme` — colours, fonts and corners for dashboards: `themes/<id>.json`
- `/set-up-assistant` — the optional chat assistant: provider, key in `.env`, and its instructions in `assistant.md`
- `/current-dashboard` — resolve "this chart" / "this dashboard"
- `/apply-comments` — apply notes the user left on panels in the viewer

## Commands you will use

```bash
pnpm exec open-dashboard drivers                 # supported databases and how to connect
pnpm exec open-dashboard sources                 # test every datasource
pnpm exec open-dashboard schema [source]         # tables, columns, keys, row counts
pnpm exec open-dashboard query "SELECT …"        # run read-only SQL, see rows + types
pnpm exec open-dashboard query --dashboard <id> --name <query> --param from=2026-01-01
pnpm exec open-dashboard check [id]              # run every query, verify every panel
pnpm exec open-dashboard charts                  # every chart you can use — built-in and charts/ — before making a new one
pnpm exec open-dashboard sync-skills             # after upgrading @open-dashboard/core: refresh these skills
```

## Rules

- **SQL lives in `.sql` files, referenced by name.** Never put SQL in JSX.
- **Never invent a number.** Every figure comes from a query against the
  user's database. No hard-coded targets or benchmarks.
- **Look at the data before writing a chart** — `schema`, then `query`.
- **`open-dashboard check` passes** before you say a dashboard is done.
- Connection strings go in `.env`, never in the config file or a commit.
