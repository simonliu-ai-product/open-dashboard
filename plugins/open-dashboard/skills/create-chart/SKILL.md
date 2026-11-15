---
name: create-chart
description: Use this skill when a dashboard needs a chart that none of the built-in panels draws — a radar, a bespoke gauge, a domain-specific diagram — and the user wants it written once under `charts/` and reused in dashboards. Also use it to fix or restyle an existing custom chart under `charts/`. Do NOT use it when a built-in panel fits (check `dashboard-authoring` → *Choosing a panel* first), for dashboards themselves (`create-dashboard`), or for colours and fonts across a dashboard (that is a theme in `themes/`).
---

# Create a custom chart

A custom chart is one folder:

```
charts/<id>/
  index.tsx     default-exports defineChart({ … })
  sample.sql    optional: a named query the Custom charts page previews it with
```

It is used in a dashboard like a built-in panel, and gets the same frame for
free: loading and error states, the inspector, notes for the agent, PNG/SVG
download, edit-mode resize and move, and the dashboard's theme.

## Step 0 — Make sure a built-in will not do

There are forty-one built-in panels, and the workspace may already have custom
ones. List them all first:

```bash
pnpm exec open-dashboard charts          # built-in + charts/, with the dashboards using each
```

Read `dashboard-authoring` → *Choosing a panel* for which form fits which job. A custom chart is for a form that is genuinely missing — not for a
restyled bar chart. If the user only wants other colours or fonts, that is a
theme (`themes/<id>.json`, edited on the Themes page), not a chart.

## Step 1 — Write the chart

```tsx
// charts/radar/index.tsx
import { defineChart } from '@open-dashboard/core'

interface RadarProps {
  axis: string     // a column: one spoke per distinct value
  value: string    // a column: the length along the spoke
  series?: string  // a column: one outline per distinct value
}

export default defineChart<RadarProps>({
  name: 'Radar',
  columns: ['axis', 'value', 'series'],
  sample: { query: 'sample', props: { axis: 'category', value: 'revenue' } },
  height: 340,
  render: ({ rows, props, width, height, color, format }) => (
    <svg width={width} height={height} role="img" aria-label={props.title}>
      {/* draw from rows, sized to width × height */}
    </svg>
  ),
})
```

The contract:

- **`name`** — shown in the inspector and on the Custom charts page.
- **`columns`** — every prop whose value is a result column name. `check` reads
  this list and fails when a dashboard names a column the query does not
  return. Leave a column prop out and it goes unchecked.
- **`sample`** — a query in this folder's `.sql` files and props for it; the
  Custom charts page previews the chart with it. Write `sample.sql` against the
  real database, like any dashboard query — never invented rows.
- **`render`** receives `rows`, `columns`, `run`, `props` (title and query
  included), `width` / `height` of the plot in px, `color(i)` and
  `format(value, format?)`. Return SVG (preferred: it exports as vectors) or HTML.

`defineChart` is a literal object — `check` reads `name`, `columns` and `sample`
without running the file, so no spreads or computed values there.

## Step 2 — Follow the house rules

The built-in panels follow these; a custom chart must too, or it will look
wrong next to them:

- **Colours come from the theme.** Series: `color(i)` (the dashboard theme's
  palette, max 8 — fold the rest into "Other"). Text: `var(--odd-ink)`,
  `var(--odd-ink-2)`, `var(--odd-tick)`. Grid: `var(--odd-grid)`. Up / down:
  `var(--odd-good)` / `var(--odd-bad)`. Never a hex code.
- **One y-axis; zero in the domain** for anything measured from zero.
- **Format numbers with `format`** (`'currency'`, `'percent'`, `'integer'`,
  `'currencyCompact'` …) so the dashboard's locale and currency apply.
- **No explanatory text inside the chart.** Titles, axes and the legend carry
  the meaning; definitions go in the query's `-- description:`.
- **Draw to `width` × `height`.** Nothing fixed-size; the panel is resizable.
- For a tooltip, `ChartTooltip` from `@open-dashboard/core` is the one the
  built-ins use. `seriesColor`, `sequential`, `diverging`, `niceDomain`,
  `linear` and `tickFormatter` are exported too.

## Step 3 — Use it in a dashboard

```tsx
import Radar from '../../charts/radar'

<Radar title="Revenue by category" query="category_revenue" axis="category" value="revenue" span={4} />
```

Import it with a **default import from a relative path into `charts/`** — that
is how `check` finds its `columns`. `title` and `query` are required, like any
panel; `span`, `height`, `drill` and `description` work as usual.

## Step 4 — Verify

```bash
pnpm exec open-dashboard check <dashboard-id>
```

Then open `/charts/<id>` in the viewer to see the sample, and the dashboard to
see it with real data. Check light and dark mode (the settings menu at the
sidebar foot) — a colour that only works on white is a hex code that slipped in.
