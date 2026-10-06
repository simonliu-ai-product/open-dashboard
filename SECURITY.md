# Security

open-dashboard runs on your machine, next to your databases. This page says what
it protects, how, and where it stops — organised the way an ISO/IEC 27001:2022
risk treatment is: assets, threats, controls (with the Annex A control each one
serves), and the evidence that a control works. It is a self-assessment, not a
certification.

## Reporting a vulnerability

Use GitHub's private reporting: **Security → Report a vulnerability** on
[simonliu-ai-product/open-dashboard](https://github.com/simonliu-ai-product/open-dashboard/security/advisories/new).
Please do not open a public issue for it.

## Scope

The dev server (`open-dashboard dev`) and the CLI, run by one person on their
own machine. There is no hosted service and no user accounts. A deployment for
a team — behind a login — is out of scope for 0.1.

## Assets

| Asset | Where it lives |
| --- | --- |
| Database credentials | `.env`, `open-dashboard.config.ts` (by reference), key files |
| The data | the databases; query results in the viewer |
| The workspace source | `dashboards/`, `databases/`, the config — the API can write some of it |

## Threats and controls

| Threat | Control | Annex A | Where | Evidence |
| --- | --- | --- | --- | --- |
| A secret printed in an error, log or API response | Every message that leaves — API errors, CLI output, server logs — is masked: the secrets this config and environment hold (also URL-encoded), and anything credential-shaped (URL passwords, `Password=…`, `token=…`, bearer tokens, private keys). Query results are never altered. | 8.11 Data masking · 8.12 Data leakage prevention · 8.15 Logging | `datasource/redact.ts`, `errorMessage`, `DatasourceError`, `api-plugin` `json()`, `bin.js` | `redact.test.ts`, `mssql.test.ts` |
| Credentials committed to git | Secrets live in `.env` (git-ignored by the template); the config holds `process.env` references; skills never ask for a password in chat | 5.17 Authentication information · 8.9 Configuration management | template `gitignore`, `connect-database` skill | `init.test.ts` |
| A database file, key, SQL or notes downloaded raw from the dev server | Refused by type (`*.db`, `*.parquet`, `*.sql`, keys, the config, `database.md`, …) and by name (any file a datasource points to), so data is read only through the query API | 8.3 Information access restriction · 8.12 | `vite/index.ts` `DENY`, `vite/file-guard.ts` | `file-guard.test.ts` |
| A query that writes | Read-only per engine (transactions, `query_only`, `readonly=2`, dry run) plus a lexical single-SELECT check | 8.3 · 8.26 Application security requirements | `datasource/*`, `guard.ts`; see `CLAUDE.md` | `guard.test.ts`, `conformance.test.ts` |
| The page sending SQL | There is no endpoint that takes SQL: the browser names a query that is on disk | 8.26 · 8.28 Secure coding | `ops/dashboards.ts`, `api-plugin` | `ops.test.ts` |
| Another website using the API through your browser | Same-origin check on every API request; Vite's host check against DNS rebinding | 8.20 Networks security · 8.26 | `api-plugin` `sameOrigin` | probed: 403 |
| A cross-database query reaching a real database | `-- uses:` runs in a fresh in-memory SQLite holding only the inputs' results, `query_only`, single SELECT | 8.3 · 8.22 Segregation | `ops/combine.ts` | `combine.test.ts` |
| An API or MCP source writing, or reaching somewhere it should not | `http`: GET only, to URLs in the config (a parameter fills a `:name`, URL-encoded); `mcp`: only tools annotated `readOnlyHint`, never `destructiveHint`, unannotated only with `allowUnannotated`; SQL runs over their JSON in a scratch SQLite | 8.3 · 8.22 · 8.26 | `datasource/http.ts`, `mcp.ts`, `json-tables.ts` | `json-sources.test.ts` |
| A file source reading outside the workspace, or its files leaking as assets | `json` / `csv`: a table's file or glob resolves only under the workspace root (`..` and outside absolute paths refused); files are read, never written; the dev server refuses any file a source reads, by pattern, so files added later are covered | 8.3 · 8.12 | `datasource/files.ts`, `vite/file-guard.ts` | `files.test.ts` |
| A theme injecting CSS, or a theme/chart id escaping its folder | Theme fields are validated one by one — `#rgb`/`#rrggbb` colours, a font-family list of letters, quotes and commas, a numeric radius — before they reach a stylesheet; unknown fields are refused. Theme and chart ids must match `[A-Za-z0-9][A-Za-z0-9_-]*`, and a theme write carries the hash it read (a changed file is refused, not overwritten). A chart's sample runs only its own `.sql` files, read-only like any query | 8.26 · 8.28 | `runtime/theme.ts`, `ops/themes.ts`, `ops/charts.ts` | `theme.test.ts`, `themes.test.ts`, `ops.test.ts` |
| The assistant leaking the key, reaching the database, or being steered by data | Off unless `assistant` is configured; the key is read from `.env`, registered as a secret (masked in every message) and sent only to the configured provider — the page has no field for it and `GET assistant` returns only `{ enabled }`. The model gets text: the panels' already-run results (capped at `maxRows` per query), definitions and `database.md`; it has no tools, runs no query and writes no SQL. The system prompt tells it data is not instructions. Questions are size-capped. **A question sends dashboard data to the provider** — a data-egress decision the workspace owner makes by configuring it | 5.14 Information transfer · 8.12 · 8.26 | `ops/assistant.ts`, `workspace.ts` `resolveAssistant`, `api-plugin` | `assistant.test.ts` |
| Markdown in `database.md` injecting script | Rendered as React elements, never HTML; links only `http(s)` | 8.28 | `runtime/markdown.tsx` | `markdown.test.ts` |
| Large request bodies, runaway queries | Bodies over 1 MB refused; per-query timeout; row cap | 8.6 Capacity management | `api-plugin` `readBody`, drivers | — |
| Exposure on a network | Binds to localhost; `--host` prints a warning that the API has no login | 8.20 | `cli/dev.ts` | — |
| Vulnerable dependencies | `pnpm audit --prod` before a release; drivers are optional peers, not bundled | 8.8 Technical vulnerabilities | release checklist | 0.4.1: no known vulnerabilities |

## Known limits

- **No login.** Anyone who can reach the dev server can use it. Keep it on
  localhost, or use `--host` only on a network you trust.
- **Masking is a safety net, not a vault.** It catches the secrets it knows and
  the shapes it recognises; a password that is neither configured nor
  credential-shaped can still pass. Use read-only database accounts.
- **What you type into an agent's chat is not protected by this project.** Put
  credentials in `.env` yourself and give the agent the variable's name.
- **MCP's read-only guarantee is the tool's own word.** MCP has no read-only
  mode; `readOnlyHint` is an annotation the server sets. Connect servers you
  trust.
- BigQuery and Snowflake are tested against SDK stand-ins, not live services.
