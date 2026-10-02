---
name: dashboard-authoring
description: Technical reference for writing open-dashboard dashboards — the file contract, the named-query .sql format, parameters and filters, every panel component and its props, number formats, layout, and chart-choice rules. Use whenever writing or editing anything under `dashboards/<id>/` (index.tsx or .sql). The workflow for drafting a new dashboard from scratch is the `create-dashboard` skill.
---

# Authoring an open-dashboard dashboard

A dashboard is a folder:

```
dashboards/<id>/
  index.tsx      the layout: which panels, in what order, showing which columns
  queries.sql    named SQL queries the panels refer to (any *.sql file here counts)
```

## The one rule

**SQL lives in `.sql` files. Panels refer to queries by name.**

The browser never sends SQL; it asks the dev server to run *query `top_products`
of dashboard `sales-overview`* with the current filter values. That keeps the
SQL reviewable, runnable from the CLI, and out of reach of anything in the page.
There is no prop that takes raw SQL — do not try to add one.

## Queries — `queries.sql`

```sql
-- name: revenue_by_month
-- source: warehouse
-- description: Paid revenue per calendar month
SELECT date_trunc('month', paid_at)::date AS month,
       SUM(amount_cents) / 100.0          AS revenue
FROM payments
WHERE status = 'paid'
  AND paid_at >= :from AND paid_at < :to
  AND (:region IS NULL OR region = :region)
GROUP BY 1
ORDER BY 1;
```

- `-- name:` starts a query. Letters, digits, `_`, `-`. Unique per dashboard.
- `-- source:` (optional) picks the datasource; omit to use `defaultSource`.
- `-- description:` (optional) is for humans and shows in the inspector.
- Those header lines must come **directly** after `-- name:`.
- A trailing `;` is fine. One statement per query.

### Parameters

`:name` placeholders are bound from the dashboard's filters — never
interpolated into the SQL text, so they are injection-safe. The same
placeholder may appear several times. Inside string literals, comments and
Postgres `::casts`, a colon is left alone.

| Filter | Binds |
| --- | --- |
| `<TimeRange />` | `:from` (inclusive) and `:to` (exclusive), as `'YYYY-MM-DD'` |
| `<TimeRange name="signup" />` | `:signup_from`, `:signup_to` |
| `<Select name="region" />` | `:region` — a string, or **NULL when "All"** is chosen |

So always write:

- time: `col >= :from AND col < :to` — `:to` is exclusive (tomorrow, for "today").
- select: `(:region IS NULL OR region = :region)`.

A query that uses a placeholder no filter provides fails with
`missing parameter :x — no filter on the dashboard provides it`.

Write each SQL for the datasource's dialect — date bucketing differs a lot
between SQLite, Postgres and MySQL: [references/sql-dialects.md](references/sql-dialects.md).

### Shape the result for the panel

- **Aggregate in SQL.** Return what the chart draws — tens or hundreds of rows.
  Results are capped (default 5,000 rows) and marked truncated.
- **Name columns for reading**: `AS revenue`, `AS signups`. Panels humanise names
  (`new_customers` → "New customers") in legends, tooltips and table headers.
- **Order the rows** the way they should appear: time ascending for trends,
  value descending for rankings. Panels do not re-sort.
- **Numbers must be numbers.** Divide with `1.0 *` in SQLite / MySQL integer
  division; cast `numeric` if needed. The CLI prints column types — check them.
- **Long vs wide** for multi-series charts: either one column per series
  (`month, web, mobile`) with `y={['web','mobile']}`, or long form
  (`month, channel, revenue`) with `y="revenue" series="channel"`. Long form is
  better when the set of series comes from the data.
- **Ratios and percents** as fractions (0.042), then `format="percent"`.
- **Comparisons** for `<Stat compare>`: return the previous-period value in the
  same row as the current one (see the dialect file for the bounds trick).

## The layout — `index.tsx`

```tsx
import {
  BarChart, Dashboard, type DashboardMeta, Filters, LineChart, Row, Select, Stat, Table, TimeRange,
} from '@open-database-dashboard/core'

export const meta: DashboardMeta = {
  title: 'Sales overview',
  description: 'Paid revenue and orders. Refunds excluded.',
  refresh: '5m',          // default auto-refresh: '30s' | '1m' | '5m' | '1h' — the reader can change it
  currency: 'USD',        // for 'currency' formats
  locale: 'en-US',        // numbers and dates; e.g. 'zh-TW', 'ja-JP'
  createdAt: '2026-10-02T00:00:00.000Z',
}

export default function SalesOverview() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange default="90d" />
        <Select name="region" label="Region" query="regions" />
      </Filters>

      <Row>
        <Stat title="Revenue" query="kpis" column="revenue" compare="revenue_prev" format="currency" />
        <Stat title="Orders" query="kpis" column="orders" compare="orders_prev" format="integer" />
      </Row>

      <Row height={320}>
        <LineChart title="Revenue by month" query="revenue_by_month" x="month" y="revenue" format="currency" span={8} />
        <BarChart title="Top products" query="top_products" x="product" y="revenue" horizontal span={4} />
      </Row>
    </Dashboard>
  )
}
```

- `meta.refresh` is only the **default**: the toolbar has an auto-refresh menu
  (off, 30 s … 1 h) and the reader's choice is kept in the URL (`?refresh=2m`).
  Do not build your own interval control.
- `meta` is a plain object literal: the dashboard list reads it without running
  the file. No spreads, no imported values.
- Default-export a component returning one `<Dashboard>`.
- `<Filters>` must be a **direct child** of `<Dashboard>`; it renders in the
  header. Filter values live in the URL (`?time=12m&region=North`), so a
  filtered view can be shared as a link.
- Every panel has a **`title`** — it is how the inspector, notes, and
  `current-dashboard` identify the panel. Keep titles unique within a dashboard.
- Name columns explicitly (`x`, `y`, `column`, `label`, `value`). Defaults
  exist, but `open-dashboard check` can only verify what is written literally.

Every component, every prop: [references/components.md](references/components.md).

## Layout

- `<Row>` is a 12-column band. Children split it evenly unless they set `span`
  (1–12). `height` on the row sets every panel's height; a panel's own
  `height` wins. KPI rows need no height.
- Typical heights: charts 280–340, tables 340–420.
- Spans should add up to 12 per row. Common splits: 3×4 Stats, 8+4, 7+5, 6+6.
- `<Section title>` groups rows under a heading on a long dashboard.
- Below ~860 px wide every panel goes full width (Stats two per row).

## Live / "today so far" dashboards

- Compute "now" **in SQL**, not with a filter: SQLite `datetime('now', 'localtime')`,
  Postgres `now()`, MySQL `NOW()`. Always cap at now — data stamped in the future
  (scheduled rows, a seeded demo) must not count as "today".
- "vs yesterday at the same time": both numbers in one row, the second bounded by
  `now − 1 day`, then `<Stat compare=… compareLabel="vs yesterday so far">`.
- Hourly or per-minute series must **fill empty buckets with 0** (a recursive CTE
  / `generate_series`), otherwise a quiet hour silently disappears from the axis
  and neighbouring bars look adjacent in time. See the dialect file.
- Hundreds of buckets read best as a `<BarChart>` (thin bars), stacked if the
  parts add up; a stacked area puts its top series' colour along the whole edge.
- A window choice ("last 7 / 14 days") is a `<Select allowAll={false}>` with
  static options, bound into SQL as text: `'-' || :days || ' days'`.

## Choosing a panel

| The reader wants | Panel |
| --- | --- |
| one number, now | `<Stat>` — with `compare` if a previous period exists |
| change over time | `<LineChart>`; `<AreaChart stacked>` if the series add up to a whole |
| compare categories | `<BarChart>`; `horizontal` for rankings / long names / > 8 bars |
| part of a whole, ≤ 6 parts | `<PieChart>` (a donut). Close values → use a BarChart |
| composition over time | `<BarChart stacked>` (few periods) or `<AreaChart stacked>` (many) |
| look things up | `<Table>` |
| a definition or caveat | `<Text>` |

Rules that are not taste:

- **One measure scale per chart.** Never put revenue and order count on the
  same axes — two charts, or index them. There is no dual-axis option on purpose.
- **At most 8 series.** Past eight, the smallest are summed into "Other". If a
  breakdown has more categories, use a Table or a horizontal BarChart of the
  top N, or filter.
- A single bar or a 2-slice pie is a `<Stat>`.
- Down-is-good metrics (cost, churn, latency, refund rate) get `invert` on `<Stat>`.
- Colour follows series order, so keep series order stable: sort long-form
  series in SQL by a fixed key (`ORDER BY month, channel`), not by value.

## Formats

`format` takes a name or any `Intl.NumberFormatOptions` object:

| Name | 1234.5 | Note |
| --- | --- | --- |
| `number` (default) | 1,234.5 | |
| `integer` | 1,235 | |
| `decimal` | 1,234.50 | |
| `compact` | 1.2K | |
| `currency` | $1,235 | `meta.currency`; cents shown under 1,000 |
| `currencyCompact` | $1.2K | |
| `percent` | — | expects a fraction: 0.123 → 12% |
| `date` / `month` | — | ISO strings → localized date / month |
| `text` | as-is | raw string, e.g. timestamps in a table |

Axis ticks pick compact notation on their own when values are large.
`{ style: 'unit', unit: 'millisecond' }`, `{ style: 'currency', currency: 'TWD' }`
and friends work too.

## Checking

```bash
pnpm exec open-dashboard check <id>
```

Runs every query with the default filter values; reports SQL errors, unknown
queries, columns a panel names that the result does not have, unbound
parameters, empty results, unused queries, truncated results. **Zero errors
before you hand a dashboard back.**

## Self-review

- [ ] Every number traces to a query; nothing is hard-coded.
- [ ] Each metric's definition is stated where a reader can see it (`description` or `<Text>`).
- [ ] Time filters use `>= :from AND < :to`; selects use `(:x IS NULL OR …)`.
- [ ] Default time range has data in it (`check` shows rows).
- [ ] The current, partial period is handled: say so, or exclude it.
- [ ] No chart has two measures of different scale.
- [ ] Rankings are horizontal bars sorted in SQL.
- [ ] `check` passes.
