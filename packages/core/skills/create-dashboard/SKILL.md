---
name: create-dashboard
description: Use this skill when the user wants a new dashboard, report, KPI board, or set of charts over their data in this open-dashboard workspace — "build me a sales dashboard", "I want to see signups per week and churn", "make a Grafana-style board for orders", "show me revenue by region", or anything that should land under `dashboards/`. Also use it to add several panels to an existing dashboard. Do NOT use for connecting a database (that is `connect-database`) or for editing the framework itself.
---

# Create a dashboard

This skill owns the **workflow**. The technical reference — file contract,
components, filters, formats, SQL per dialect — is the **`dashboard-authoring`**
skill. Read it before writing code.

You write files under `dashboards/<id>/` only: `index.tsx` and one or more
`.sql` files. Never edit `open-dashboard.config.ts` here; if there is no working
datasource, switch to `connect-database` first.

## Step 0 — Make sure there is data to look at

```bash
pnpm exec open-dashboard sources
```

Every source should show ✓. If one fails, fix that first.

## Step 1 — Learn the schema before you ask anything

Read `databases/<source>/database.md` first if it exists: it says what the
tables mean, which values to filter on, units and time zones. Trust it over
guesses from column names.

```bash
pnpm exec open-dashboard schema            # default source; add a name for another
```

Then look at real rows of the tables that matter:

```bash
pnpm exec open-dashboard query "SELECT * FROM orders ORDER BY created_at DESC LIMIT 5"
pnpm exec open-dashboard query "SELECT status, count(*) FROM orders GROUP BY 1"
pnpm exec open-dashboard query "SELECT min(created_at), max(created_at) FROM orders"
```

You are looking for: the **time column** of each fact table and its format
(DATE, TIMESTAMP, ISO text, epoch integer); the **money** columns and their unit
(cents?); **status** values that change what counts (refunded, cancelled,
test, deleted); how the tables **join**; and the **date range** the data covers —
a "last 30 days" default on data that ends last year shows nothing.

If you learn something here the file does not say (a status value, a unit),
add it to `database.md` — see `document-database`.

## Step 2 — Pin down the metrics (ask before writing code)

A dashboard is judged on whether its numbers are right, and most wrong numbers
come from an unasked question. One `AskUserQuestion` call, skipping what the
user already said, covering what the schema leaves open:

1. **Definitions** — what counts. "Revenue: paid orders only, excluding
   shipping and refunds?" "Active user: logged in, or did something?" Propose the
   definition you would use, based on what you saw in Step 1.
2. **Time** — default range, and grain (day / week / month). Suggest one that
   suits the data's range and volume.
3. **Slices** — which filters matter (region, plan, channel…). Each becomes a
   `<Select>`; two or three is plenty.
4. **Audience** — an exec wants four numbers and a trend; an analyst wants the
   breakdown table. It decides how many panels.

If the user said "just make something useful", choose sensible definitions,
build it, put each definition in the query's `-- description:` line (the
inspector shows it), and list them in your reply so they can correct you.
Do not write them onto the page.

> **Never invent a number.** Every figure on a dashboard comes from a query
> against the user's database. No hard-coded targets, benchmarks, "typical
> conversion rates", or placeholder values dressed up as data. If a target is
> wanted and does not exist in the database, ask for it.

## Step 3 — Pick an id

kebab-case, short: `sales-overview`, `signup-funnel`, `support-queue`. Check
`dashboards/` for collisions.

## Step 4 — Plan the panels

Write the plan as a short list before code — one line per panel: title, form,
query. The usual shape, top to bottom:

1. **Filters** — a `<TimeRange>` and at most a few `<Select>`s.
2. **KPI row** — 3–5 `<Stat>`s: the numbers the reader checks first, each with
   a comparison to the previous period when that means something.
3. **Trend** — one `<LineChart>`/`<AreaChart>` of the main measure over time.
4. **Breakdowns** — `<BarChart>`s (horizontal for rankings and long names), a
   `<PieChart>` only for a part-of-whole with ≤ 6 slices.
5. **Detail** — a `<Table>` for top-N lists or recent records.

Pick the form by the data's job (see `dashboard-authoring` → *Choosing a panel*).
Then list what this workspace already has — the built-in panels and any custom
charts under `charts/`, with the dashboards that use each:

```bash
pnpm exec open-dashboard charts          # --json for machine-readable output
```

A custom chart in that list is used like a built-in. Only when nothing fits,
write one with the `create-chart` skill.
Six to ten panels is a good dashboard; twenty is a wall nobody reads.

## Step 5 — Write the queries first

`dashboards/<id>/queries.sql`, one `-- name:` block per query. Then **run every
one** before writing any JSX:

```bash
pnpm exec open-dashboard query --dashboard <id> --name revenue_by_month \
  --param from=2026-01-01 --param to=2026-10-01 --param region=null
```

Look at the output: right columns, right types (`types:` line — numbers must
be `number`, not `string`), plausible magnitudes, sensible row count. A chart
needs the aggregation done in SQL — return tens or hundreds of rows, not raw
events.

## Step 6 — Write `dashboards/<id>/index.tsx`

Follow `dashboard-authoring`. Name columns explicitly on every panel (`x`, `y`,
`column`, `label`, `value`) so `check` can verify them.

## Step 7 — Check it

```bash
pnpm exec open-dashboard check <id>
```

It runs every query with the dashboard's default filter values and verifies
every query a panel names exists and every column a panel names is in that
query's result. **It must pass with no errors.** Treat "returns no rows" and
"defined but no panel uses it" warnings as things to fix or explain.

Then look at what you drew — `check` cannot see a cut-off label or a chart
that hides the point:

```bash
pnpm exec open-dashboard render <id>                      # the whole page → a PNG path
pnpm exec open-dashboard render <id> --panel "<title>"    # one panel, larger
```

Read the PNG it prints. Fix what a reader would trip on — overlapping or
truncated labels, a flat or empty chart, a pie with too many slices, colours
too close to tell apart — and render again. Without Playwright it says how to
install it; if the user does not want it, open `http://localhost:5473/d/<id>`
and ask them to look.

## Step 8 — Report

Tell the user: the URL, one line per panel, every **definition you assumed**,
and anything that looked odd in the data (gaps, a partial current period,
outliers). Mention they can leave notes on any panel with the inspector and ask
you to `/apply-comments`.
