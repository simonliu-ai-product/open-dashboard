# Changelog

Every release of `@open-dashboard/core`, `@open-dashboard/cli` and `@open-dashboard/mcp`,
which share one version. What each line means for a workspace, and how to move a
workspace forward, is in [docs/compatibility.md](docs/compatibility.md): after
installing a new version, run `open-dashboard upgrade`.

## 0.13.1 — 2026-11-22

Serve a workspace from a shared core, and recognise a host that embeds a single dashboard.

- **A workspace needs no install of its own.** Core already handed dashboards its own copy of itself and of React; `OPEN_DASHBOARD_CACHE_DIR` now also moves Vite's cache out of the workspace, so a host app can serve many workspaces from one shared core.
- A standalone dashboard also recognises `__OPEN_X_HOST__` (it read only the name the host contract had first).

## 0.13.0 — 2026-11-15

Manage dashboards from the page, take all of one to Excel, and edit layouts with fewer trips to the agent.

- **Dependencies patched**: vite, zod and hono raised to versions without the advisories `pnpm audit --prod` reported (see SECURITY.md for the one left, which does not apply).
- **Duplicate and remove panels in Edit, as open-doc's element panel**: each panel in a row gets *Duplicate* (a copy right after it, titled "… (copy)", its notes left with the original) and *Remove* (with the note marker above it; a row left empty goes too). Both are staged like any edit — previewed at once, undone with Undo, written on Save — through the same `applyStructure` the server writes with. In Edit the panel's actions now sit on its top edge on hover, so a narrow panel's title no longer wraps.
- **New dashboard from the home page, as open-doc's new document**: *New dashboard* opens a title field at the top of the list; Enter writes `dashboards/<id>/index.tsx` — the id from the title (`Weekly KPIs` → `weekly-kpis`, `dashboard` for a title with no Latin letters, numbered when taken), one *Start here* panel pointing at `/create-dashboard` — and opens it. Clicking away from the untouched suggestion creates nothing. `POST dashboard/create`; `createDashboard` in ops. The command palette (⌘K) offers *New dashboard* anywhere, and on a dashboard *Rename*, *Duplicate* and *Move to the trash* — the last opening the ⋯ menu at its confirm step.
- **Rename, duplicate and delete a dashboard, as open-doc's documents**: a ⋯ menu in the dashboard header. *Rename…* turns the title into a field and writes `meta.title` (quotes escaped, the rest of the file untouched); *Duplicate* copies the folder — layout, queries, notes — to `<id>-copy` titled "… (copy)" and opens it; *Delete…* asks for a second click and moves the folder to `.open-dashboard/trash/`, never erasing it. The same through `POST dashboard/rename|duplicate|delete` and MCP `rename_dashboard`, `duplicate_dashboard`, `delete_dashboard`. Not offered on a built snapshot or a read-only page. The home list has the same ⋯ on every row, as open-doc's document cards: rename in place, duplicate or delete without leaving the list. Past four dashboards the list gets a search field, matching title, description, id and source names.
- **A test that the package ships what the browser compiles**: workspaces compile core from its source, so `packed-sources.test.ts` walks every runtime import from the viewer and the dashboard runtime and fails if `files` leaves one out — the failure open-doc 0.14.0 shipped with. Verified once by packing core, installing the tarball into a fresh `create-open-dashboard --sample` workspace and running `check`, `dev` and a panel's XLSX download.
- **Writes are atomic**: a dashboard's `index.tsx` and `.sql` files, shared queries, themes, review notes, `current.json` and collector state are written to a temporary file and renamed into place (`ops/atomic.ts`), as open-doc writes `current.json`, so Vite's reload or an agent reading meanwhile never sees half a file. An existing file keeps its permissions.
- **A plugin for Claude Code and Antigravity** (`plugins/open-dashboard`, listed by `.claude-plugin/marketplace.json`): the skills, the house rules and `open-dashboard mcp` over stdio, installed once per agent. `pnpm sync-plugin` copies core's skills into it; a test fails when they drift.
- **Download the whole dashboard as Excel**: the dashboard's Download menu has XLSX — one sheet per panel with rows, in page order, each named after its panel (made valid and distinct), the header bold, frozen and filterable; the rows are the ones on screen, under the current filters (`runtime/panel-runs.ts` remembers each panel's last result). Built and served pages have it too.
- **Download a panel as Excel (.xlsx)**: beside CSV, JSON and Markdown, a panel with rows downloads as a workbook — the header bold, frozen and filterable, numbers and booleans typed, columns sized to their contents, the sheet named after the panel. Written by `runtime/xlsx.ts`, no library.
- **Spreadsheets as a source (docs)**: an open-spreadsheet workbook feeds a `csv` source through a collector running `open-spreadsheet export`; README shows how.
- **CJK text follows its own language, as in open-doc (#69)**: the dashboard page carries `meta.locale` as its `lang`, so Traditional and Simplified Chinese, Japanese and Korean each get their own fonts first and strict line breaking — whatever language the viewer's interface is in. The chrome does the same for the interface language. A theme's `font` still wins.
- **Review notes on the page, as in open-doc's Comments panel**: the "N notes" pill in the dashboard header opens the list — each note with the panel it is about (`listComments` now returns `panel`), *Show panel* to scroll to and highlight it, and *Resolve* to remove its marker (`POST comment/resolve`, refused when the line no longer holds that note). Agents get the same through MCP `resolve_comment`, and the `apply-comments` skill uses it.
- **`pnpm check` passes again** with the newer Biome rules: useless fragments removed from the chart icons, and descending-specificity turned off for CSS, where rules are ordered by component.
- **Saves work behind a proxy that forwards the host but not the scheme** (Cloud Shell's Web Preview, tunnels): the origin check now reads `x-forwarded-host` and `x-forwarded-proto`, and when no scheme is stated accepts http or https for the forwarded host — the same rule as open-doc.

## 0.12.0 — 2026-10-20

Quality you can check, builds that come out the same anywhere, and a path forward.

**Verify**
- `-- expect:` rules on a query — `rows > 0`, `not_null a, b`, `unique a, b`,
  `col between 0 and 1`, `col >= 0` — checked by `open-dashboard check` on every run,
  never shown to readers. A rule that cannot be read fails rather than passes.
- `check --param key=value` checks at other filter values; `check --all-params` runs
  every query over every filter combination a build would store and names the first
  params each problem shows up at. The MCP `check_dashboard` tool takes `params` and
  `all_params`.

**Speed**
- `check` warns about a query slower than `--slow-ms` (default 1000 ms), and with
  `--all-params` lists the queries that cost most summed over every run.
- `build` prints the time spent in queries per dashboard and names the queries most of
  it went to.

**Portable builds**
- `timeZone` in the config (`'Asia/Taipei'`): the wall clock builds stamp, time ranges
  resolve against and SQLite's `'localtime'` reads, on any machine.
- Every source is `live`, `collected` or `static`, worked out from its type and its
  collectors (override with `freshness:` on the source). `check` prints each
  dashboard's sources by freshness, the built `dashboards.json` carries them, and
  `build` says when `meta.refresh` cannot bring newer data to a build made elsewhere.
- A query that only reads other queries (`-- uses:`) no longer counts as reading the
  default source.

**Hosts**
- The Open-X host contract ([docs/host-integration.md](docs/host-integration.md)): a
  built page answers `open-x:data-updated` from the page that frames it by reading its
  data again in place, keeping filters and scroll; it reloads itself when it cannot.
  Embedding is `__OPEN_X_HOST__` / `data-open-x-embed` (the names this had first still
  work). `dashboards.json` carries `builtAt`.

**Upgrading**
- `open-dashboard upgrade` lists what a workspace needs after a new version is
  installed — stale skills, a `package.json` range that would install the old version
  back, local patches of the framework that no longer apply — and `--write` does what
  it can, recording the version in `package.json` (`openDashboard.version`).
- `lint` gains `duplicate-query` (the same SQL in two dashboards: share it from
  `queries/`), `refresh-without-live-source` and `missing-expectations`.
- The skills teach these: write invariants as `-- expect:`, check with `--all-params`,
  share SQL through `queries/`, keep moving data on live sources, set `timeZone`.

**Also**
- A snapshot whose stored runs miss a filter combination asks its host for
  `data/__odd_query.json`. A host can only answer from a `build --queryable`, which
  adds each query's SQL and the SQLite files the dashboards read; a default build
  still holds results only — no SQL, no database.
- The viewer has an embed (kiosk) mode; the Changes view groups files with a search
  and shows the branch.

## 0.11.1 — 2026-10-15

- Download menu no longer clips on compact Stat panels.

## 0.11.0 — 2026-10-15

- NumberRange filter, Stat goal, chart annotations and anomalies, Table `groupBy` and
  copyable cells, Markdown export, starred dashboards, `lint` in the CLI and MCP.

## 0.10.0 — 2026-10-14

- `open-dashboard deploy gcp` (Cloud Run + GCS FUSE + remote MCP).
- `<MultiSelect>` with `IN (:param)` expansion; Table row detail drawer; Git changes
  and revert view (`/changes`); six MCP tools for explain, report, shared queries and
  changes.

## 0.9.0 — 2026-10-14

- SearchInput, Toggle, TimeRange `allowCustom` and `compare` (`:prev_from`, `:prev_to`).
- CSV and JSON panel export; Tabs with `?tab=`; `meta.views`; kiosk mode (`?kiosk=1`).
- Target lines, brush zoom, `-- alert:` badges; Table search, pagination, footer,
  sparklines, heatmap colours, deltas and links; `drillTo`; fullscreen panels.
- Shared queries in `queries/*.sql`; command palette (⌘K); Markdown table sources;
  Explain tab; `open-dashboard diff` and `report`.

## 0.8.0 — 2026-10-13

- `open-dashboard serve`: a read-only server for readers, with live results.
- The assistant answers from other dashboards and compares filter values.
- Static analysis follows props to constants; CSV headers keep their columns with no
  rows; dev prints reloads and collector runs.
