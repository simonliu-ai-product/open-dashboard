# Changelog

Every release of `@open-dashboard/core`, `@open-dashboard/cli` and `@open-dashboard/mcp`,
which share one version. What each line means for a workspace, and how to move a
workspace forward, is in [docs/compatibility.md](docs/compatibility.md): after
installing a new version, run `open-dashboard upgrade`.

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
  Embedding is `__OPEN_X_HOST__` / `data-open-x-embed` (the earlier CoStaff names still
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
