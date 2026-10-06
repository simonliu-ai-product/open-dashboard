# open-dashboard — repository guide

This file describes the **framework repo**. If you are authoring dashboards in a
scaffolded workspace, you want the `create-dashboard` / `dashboard-authoring`
skills instead (`packages/core/skills/`).

## Layout

pnpm + Turbo monorepo.

| Path | Package | Role |
| --- | --- | --- |
| `packages/core` | `@open-dashboard/core` | Datasource drivers, named-query loader, ops layer, Vite plugins + dev API, viewer app, panel components, `open-dashboard` CLI, canonical skills. |
| `packages/cli` | `@open-dashboard/cli` | `npx @open-dashboard/cli init` scaffolder + project template. New workspaces start empty (connect a database → create a dashboard); `--sample` adds a generated SQLite shop and a getting-started dashboard. |
| `apps/demo` | private | Dogfood workspace over a seeded SQLite shop (`scripts/seed.mjs`). |
| `scripts/` | — | `screenshot.mjs`, `interact.mjs`, `pages.mjs` (Charts and Themes pages): Playwright drivers against a running viewer. |

Shared config at the root: `biome.json`, `turbo.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`. Toolchain pinned in `.mise.toml` (Node 24, pnpm 11).

## Commands

```bash
pnpm dev          # seeds apps/demo/data/shop.db if missing, runs the demo (port 5473)
pnpm build        # build all packages
pnpm typecheck    # tsc across the monorepo
pnpm check        # biome: format, lint, organize imports
pnpm check:fix
pnpm test         # vitest (node + one jsdom suite)
pnpm demo check   # open-dashboard check against the demo
```

Filter to one package: `pnpm core <script>`, `pnpm cli <script>`, `pnpm demo <script>`.

**After changing `packages/core/src/{cli,ops,datasource,queries,vite,workspace}`, rebuild core (`pnpm core build`)** — the CLI and the dev server run from `dist`. The browser side (`src/app`, `src/components`, `src/runtime`) is served from source by Vite and needs no rebuild.

## The one invariant

**The browser names a query; it never sends SQL.**

`GET /__odd/api/query?id=<dashboard>&name=<query>&params=<json>` is the only way a
query runs from the viewer. The server reads `dashboards/<id>/*.sql` from disk,
binds params positionally, and runs it. There is no endpoint, prop, or option
that accepts SQL text from the page, and there must never be one — that is the
whole security model of the dev API. The CLI's `open-dashboard query "<sql>"` is
fine: it runs in the user's own shell.

Second line of defence, per driver — keep every one:

- SQLite: opened `readOnly` **and** `PRAGMA query_only = ON` (the flag alone does not cover ATTACHed files).
- Postgres: every query inside `BEGIN READ ONLY … ROLLBACK` with `SET LOCAL statement_timeout`.
- MySQL: `START TRANSACTION READ ONLY … ROLLBACK` **and** `assertReadOnlySql` — MySQL commits DDL implicitly, so a `CREATE TABLE` runs straight through the read-only transaction (the conformance suite caught exactly this).
- Oracle: `SET TRANSACTION READ ONLY` **and** `assertReadOnlySql`, for the same DDL reason.
- SQL Server: no read-only transaction exists — `assertReadOnlySql`, then a transaction that is always rolled back.
- DuckDB: file opened `READ_ONLY`; `:memory:` cannot be, so `assertReadOnlySql` (blocks COPY/ATTACH/INSTALL/SET).
- ClickHouse: `readonly = 2` on every request (`1` would forbid the request's own settings).
- BigQuery: a dry run must report `statementType = SELECT` and scan under `maximumBytesBilled`, which is also set on the real job.
- Snowflake: `assertReadOnlySql`; the read-only role from the connect skill is the real protection.

**Every message that leaves the process is masked** (`datasource/redact.ts`, see `SECURITY.md`): `errorMessage()` and `DatasourceError` mask at the source, `api-plugin`'s `json()` masks error payloads again, `bin.js` prints through `describeError`, and the config loader registers the secrets of every datasource and secret-looking env var. A new error path, log line or CLI message must go through `errorMessage`/`redact` too. Query results are never masked — they are the user's data. The dev server refuses raw files by type (`DENY` in `vite/index.ts`) and any file a datasource names (`vite/file-guard.ts`): data is read only through the query API.

**`http` and `mcp` sources are tables over JSON** (`datasource/json-tables.ts`): a query fetches only the tables it names (`tablesIn`), each through a short per-table cache, turns the rows into a result (nested values as JSON text) and runs the SQL in the same scratch SQLite as `-- uses:` (`datasource/scratch.ts`). `http` sends GET only, to config URLs; `mcp` (`datasource/mcp.ts`, our own JSON-RPC client over streamable HTTP and stdio — no SDK dependency) calls only `readOnlyHint` tools, never `destructiveHint`. Keep both rules.

Cross-database queries (`-- uses:`, `ops/combine.ts`) never touch a datasource themselves: each input runs through its own driver above, and the combining SQL runs in a fresh `:memory:` SQLite holding only those results, behind `assertReadOnlySql` and `query_only`. That is what makes it safe to join across engines — keep it that way (no ATTACH, no passing a real connection in).

Results are cached server-side (`ops/query-cache.ts`, on `Workspace`): keyed by dashboard, query and only the params the query (and its inputs) read; stored as the pending promise so concurrent identical requests share one run; failures are not kept. Default TTL from config `cache` (30 s), per query `-- cache:`. `fresh` (the refresh button, `check`, the CLI) bypasses it. A `.sql` change clears that dashboard; a config reload clears all.

`assertReadOnlySql` (`datasource/guard.ts`) is lexical: one statement, starting SELECT/WITH/…, no write keyword outside strings, quoted identifiers and comments. A keyword followed by `(` is a function call (`REPLACE(…)`, `TRUNCATE(x, 2)`) and is allowed.

## Drivers

Every driver lives in `datasource/<engine>.ts`, implements `Datasource` (`query`, `schema`, `close`), and is listed once in `datasource/registry.ts` (which feeds `open-dashboard drivers`, errors and docs) and once in the `openDatasource` switch. Rules every driver follows — `conformance.test.ts` checks them against real servers (set `ODD_TEST_<ENGINE>_URL`; SQLite and DuckDB always run):

- Placeholders: compile `:name` with `compileParams` into the engine's form (`?`, `$1`, `@p1`, `:p1`, `{p1:Type}`); never interpolate.
- Integers beyond 2⁵³ stay strings; everything else numeric is a JS number.
- Timestamps without a zone come back as their wall-clock text (`YYYY-MM-DD HH:MM:SS`), never shifted through the server's or client's time zone; zoned ones as ISO instants. Each driver gets there differently (pg type parsers, mssql UTC fields, oracledb local fields, DuckDB's JSON conversion) — check with the conformance suite, not by eye.
- Upper-casing engines (Oracle, Snowflake) fold all-caps names to lower case (`foldUpperCase`).
- Row cap `maxRows`, `truncated` when more existed; per-query timeout where the engine has one.
- Drivers are optional peers resolved from the workspace (`peer.ts`), external in the build, imported only when a datasource of that type opens.

## Architecture

```
dashboards/<id>/queries.sql  ──parse──▶ NamedQuery{name, source, sql}
dashboards/<id>/index.tsx    ──Vite──▶ React tree in the viewer
                                       │ panel: useQuery('top_products')
                                       ▼
                   host.fetchQuery ─▶ /__odd/api/query ─▶ ops.runDashboardQuery
                                                            ▼
                                     compileParams(:name → ?/$n) → driver (read-only)
                                                            ▼
                                     normalizeRows → { columns[type], rows, truncated }
```

- **`ops/` is the only implementation.** `vite/api-plugin.ts` and `cli/bin.ts` are thin shells over it. Anything that reads a dashboard, runs a query, or writes a file belongs in `ops/`. `OpsError` carries the HTTP status.
- **Parameters are compiled by a scanner, not a regex** (`datasource/params.ts`). It must skip string literals, quoted identifiers, `--`/`/* */` comments, Postgres `$tag$` bodies and `::casts`. Extend `params.test.ts` with every new case.
- **Rows are normalised once, server side** (`datasource/normalize.ts`): bigint → number (or string if unsafe), Date → ISO string, bytes → placeholder; each column gets a type. A chart written against SQLite renders identically against Postgres.
- **Optional drivers are resolved from the user's workspace first** (`datasource/peer.ts`): under pnpm's strict layout core cannot see `pg`/`mysql2` it does not depend on. They are optional peers, external in the build, and never imported at module top level.
- **Config is loaded by Node itself** (`workspace.ts`): native TypeScript type stripping (Node ≥ 22.18) imports `open-dashboard.config.ts` with an mtime query to bust the cache. That is why the template config uses `import type` + `satisfies` — anything that is not erasable syntax breaks it. `.env` fills in what the shell did not set; a reload replaces only what the file set before.
- **The browser gets core from source, not dist** (`vite/index.ts`). Dashboards and the viewer resolve `@open-dashboard/core` to `src/index.ts`, so there is one module graph and one React context. The contexts are also stashed on `globalThis` (`runtime/context.ts`) in case a second copy ever loads. React itself is aliased to core's copy; a workspace has no React dependency.
- **Filters are collected before any panel mounts.** `<Dashboard>` walks its `<Filters>` element tree and calls each filter component's static `filterSpec(props)` to get key, default and param mapping. Registering from a filter's own effect would let every panel fire once without params and fail. Filter values live in the URL (`?time=12m&region=North`); a value equal to the default is omitted, `''` means NULL.
- **`check` and the dashboard list read TSX statically** (`ops/analyze.ts`, Babel). Only literal props count; that is deliberate — it reports less rather than guesses. It verifies query names, columns panels name against real result columns, and params against filters, by running each query with the defaults the browser would use (`runtime/time-range.ts` is shared by both sides).
- **Notes from the inspector are source edits** (`ops/comment.ts`). The file is parsed strictly first (a recovered tree has wrong offsets); the marker goes above the panel whose `title` matches, as `{/* @dashboard-comment: … */}` in JSX child position, `/* … */` otherwise. `*/` in the note is defused.
- **The viewer records what the user is looking at** in `node_modules/.open-dashboard/current.json` (dashboard, last inspected panel + query, filter params) for the `current-dashboard` skill.
- **The chrome speaks open-doc's five languages** (English, 繁體中文, 简体中文, 日本語, 한국어). `runtime/i18n.tsx` provides `useT()`; the English text is the key, dictionaries live in `runtime/i18n-<locale>/{app,panels}.ts`. Every new chrome string goes through `t` with a translation in all four dictionaries — `i18n.test.ts` scans `app/` and `components/` for `t('…')` literals and fails on any without one. Dashboard content (titles, labels, `compareLabel`) is never translated. Number formats follow `meta.locale`, else the viewer's language. The settings menu at the sidebar foot (theme + language) opens upward.
- **Edit mode edits source, not state** — the open-doc design-panel rule. The dashboard header has Preview / Edit (`app/components/dashboard-header.tsx`); only in Edit do panels show resize handles and a reorder grip (`components/edit-chrome.tsx`) and does the inspector's Chart tab (`app/components/chart-settings.tsx`) accept changes. Every change is a `LayoutEdit` (`runtime/convert.ts`), staged in `app/lib/use-layout-edit.ts`, previewed by `foldEdits` (`runtime/edit.tsx`) and the `editable()` wrapper each panel is exported through (`components/editable.tsx`), and written only by Save: `POST /__odd/api/layout` → `ops/layout.ts`, which re-parses strictly, splices by AST offset, and refuses when the file's hash differs from the one the page read (the agent edited meanwhile). Type changes go through `convertProps`, shared by preview and write, so what is saved is what was shown. Moving panels between rows and rows within their parent is a `move` / `moveRow` edit whose meaning lives in one pure function, `applyStructure` (`runtime/structure.ts`): the page folds staged edits through it and `<Dashboard>` re-arranges its element tree to match (panels keyed by title, so moves within a parent keep their DOM node); the server runs it to validate, then cuts and re-indents the panel's source (note markers travel with it) or permutes the row slots, and drops a `<Row>` left empty. Rows are numbered in document order; structural editing switches off when the rendered rows don't match the source's rows (rows built by a loop). Query results are kept until the next refresh, so a panel re-mounted by a move does not re-query. Leaving Edit with unsaved changes is blocked, not auto-saved. Extend `ops/layout.test.ts` with any new edit kind.
- **`databases/<source>/database.md` is the database's AGENTS.md** (`ops/database-doc.ts`, skill `document-database`): what tables and columns mean, values to filter on, units, traps. Only configured source names resolve to a path. The Data sources page has two views (Docs / Schema, remembered per browser): Docs renders it with `runtime/markdown.tsx` — a small Markdown subset rendered as React elements, never HTML — splitting it with `splitDatabaseDoc`: overview and `##` sections at the top, each `### <table>` under `## Tables` on that table, and list items starting with a `` `column` `` under that column. Edits reload live (`odd:database-doc-changed`). `open-dashboard schema` prints its path first so the agent reads it.
- **Drill-down is declared, not coded**: `drill` on a panel (`components/drill.ts`) sets a filter (or opens another dashboard) on click; off in edit mode; `check` warns about a drill into a missing `<Select>`.
- **Auto-refresh is the reader's setting.** `meta.refresh` is the default; the toolbar menu overrides it and stores `?refresh=` in the URL (`app/lib/refresh.ts`), so a wall-display link keeps its interval. Floor of 5 s.
- **A replaced SQLite file is reopened** (`datasource/sqlite.ts` compares the inode per query). A seed script or a fresh export swaps the file underneath, and an open handle would otherwise serve the deleted copy indefinitely.
- **Themes are CSS variables, scoped** (`runtime/theme.ts`, `ops/themes.ts`, `app/views/themes.tsx`). `themes/<id>.json` is validated field by field (`validateTheme`: hex colours, a font-family list, radius 0–24 — nothing else reaches CSS) and turned into `--odd-*` overrides under `[data-odd-theme="<id>"]` on `.odd-themed`, which wraps the dashboard header and page. Each mode's colours sit under the same pair of selectors `styles.css` uses for that mode, so a theme that sets only light colours leaves dark mode built-in. `-ink` colours are derived by contrast, never set. Charts never read colours in JS — keep it that way, or themes stop applying. Choice order: `meta.theme` (set from Edit mode as a `{ kind: 'meta' }` LayoutEdit) → config `theme` → built-in. The module's `meta` is read once, so the viewer asks the server for the saved theme after a save (`useSavedTheme`). Writes go through `writeTheme` with the same hash check as layouts; the theme editor switches `data-theme` on the root while open so the preview shows the mode being edited.
- **Custom charts are panels by contract** (`components/define-chart.tsx`, `ops/charts.ts`, `app/views/charts.tsx`). `charts/<id>/index.tsx` default-exports `defineChart({ name, columns, sample, render })`, which wraps `render` in `PanelFrame` — states, inspector, notes, download, edit chrome and theme come with it. `check` follows a dashboard's default imports from a relative path into `chartsDir` (`chartImports`) and reads the literal `columns` with Babel; a chart imported any other way is ignored, like any unknown component. A sample runs through `GET chart-query` from the chart's own `.sql` files (`runChartQuery`, cache scope `chart:<id>`) — the browser still never sends SQL. In the layout, any capitalised element that is not structure (`Dashboard`, `Row`, `Section`, `Filters`, `TimeRange`, `Select`) and has a literal `title` is a panel (`isPanelElement`) — the same rule the page uses to key rows — so custom charts resize and move; only `PANEL_TYPES` can change type. The Charts page and `open-dashboard charts` read one list, `chartCatalog` (`ops/charts.ts`): the built-ins from `runtime/catalog.ts` (`CHART_GROUPS`, `TYPE_LABELS` — shared with the type picker) plus `charts/`, each with the dashboards using it; a built-in's preview is the first use whose props are all literal, drawn through `panelImplementation` with that dashboard's queries and `check`'s default params.
- **Panel export draws the laid-out DOM as SVG** (`runtime/export-panel.ts`): boxes → rects, text nodes → `<text>` at their laid-out lines, each chart `<svg>` copied with computed styles inlined and colours normalised through a canvas (`color-mix()` and `var()` do not survive outside the page). No `<foreignObject>` — that only renders in browsers. Chrome to leave out is listed in `SKIP`; a new overlay (tooltip, hover mark, edit handle) must be added there or carry `data-export-skip`. PNG is that SVG drawn at 2×.
- **The assistant answers from the page, not the database** (`ops/assistant.ts`, `app/components/assistant.tsx`). On only when `assistant` resolves (provider, model, and a key — or a local OpenAI-compatible `baseUrl`); the viewer asks `GET assistant` for `{ enabled }` and renders nothing otherwise. `POST assistant` takes the dashboard id, the reader's params and the conversation; the server builds the context itself (`dashboardContext`: each panel's result through `runDashboardQuery`, so the cache the page filled, capped at `maxRows`; `-- description:`; `database.md`), masks it, and streams an OpenAI-compatible `chat/completions` reply back as plain text. Gemini goes through its OpenAI-compatible endpoint, so there is one client and no SDK dependency. The system prompt is built-in rules, then `assistant.md` (workspace root) and `dashboards/<id>/assistant.md`, then the data (`systemPrompt`); the files are read per question and only append — keep the built-in rules first. Never give the model tools, SQL, or the key; never add a key field to the page.
- **Live reload:** `.sql` edits send `odd:queries-changed` (panels refetch, no page reload); `index.tsx` edits go through React Fast Refresh; adding/removing a dashboard regenerates `virtual:open-dashboard/manifest`; config or `.env` edits rebuild the workspace and close old pools.

## Charts

Hand-written SVG, no chart dependency. The visual rules follow the dataviz method and are not taste:

- Categorical palette `--odd-series-1..8` — a validated order with separate dark-mode steps. Never generate a 9th hue: `shapeSeries` folds the tail into "Other".
- One y-axis. There is no dual-axis option and there must not be one.
- 2px lines, bars ≤ 24px with a 4px rounded data end and a square baseline end, 2px surface gaps between stacked segments, hairline solid gridlines, zero always in the domain.
- One tick formatter per axis (`tickFormatter`) so ticks never mix `$10K` and `$8,000`.
- Text uses ink tokens, never series colours.
- Status colours (`--odd-good`, `--odd-bad`) are only for deltas and connection state, always with an arrow or icon.

## Conventions

- **Biome must pass before commit.** `pnpm check`.
- **Dependencies in `core` are load-bearing** — it ships to every user. No chart library, no ORM, no date library. Drivers stay optional peers.
- **Never invent a number** — not in the demo, not in the template, not in a skill example presented as real. Demo data is generated by a seeded script and labelled fictional.
- Skills under `packages/core/skills/` are canonical. `packages/cli/template/skills` is generated by `scripts/sync-skills.mjs` at build time and git-ignored — never edit it by hand.
- **Default to no comments.** Only the non-obvious *why*. No section banners, no commented-out code.

## Naming

`dashboards/<id>/index.tsx` + `*.sql` · `charts/<id>/index.tsx` (`defineChart`) · `themes/<id>.json` · `open-dashboard.config.ts` · CLI `open-dashboard` · dev port **5473** · API prefix `/__odd/api/` · CSS vars `--odd-*`, classes `odd-*` · marker `@dashboard-comment` · current view `node_modules/.open-dashboard/current.json` · HMR event `odd:queries-changed`
