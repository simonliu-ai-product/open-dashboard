# Components

All from `@open-database-dashboard/core`. Every panel takes the common props:

| Prop | Type | |
| --- | --- | --- |
| `title` | string | **required**; unique within the dashboard |
| `description` | string | one line under the title — put definitions here |
| `span` | 1–12 | width in the row's 12 columns; default: row split evenly |
| `height` | number | px; default: the row's `height`, else the panel's own |

## Structure

### `<Dashboard>`
The root. Renders `meta.title` / `meta.description`, the filter bar, and the
grid. Children: `<Filters>`, `<Row>`, `<Section>`, or bare panels (full width).

### `<Filters>`
Direct child of `<Dashboard>`. Holds `<TimeRange>` and `<Select>`.

### `<Row height?>`
A 12-column band.

### `<Section title description?>`
A heading spanning the grid, with rows inside.

## Filters

### `<TimeRange name? label? default? options?>`
- binds `:from` / `:to` (or `:<name>_from` / `:<name>_to`), `'YYYY-MM-DD'`, `:to` exclusive
- `default`: `'today' | '7d' | '30d' | '90d' | '6m' | '12m' | 'mtd' | 'ytd' | 'all'` (default `'30d'`)
- `options`: which presets to offer, in order
- `'all'` binds `0001-01-01` … `9999-12-31`

### `<Select name label? query? options? default? allowAll? allLabel?>`
- binds `:<name>`; "All" binds NULL
- `query`: a named query; first column = value, second (optional) = label
- `options`: static `['a', 'b']` or `[{ value, label }]`
- `default`: initial value (default: All / NULL)
- `allowAll={false}`: no "All"; starts on `default`, else the first option

## Panels

### `<Stat query column? format? compare? compareLabel? invert? spark?>`
Reads the **first row**.
- `column`: value column (default: first numeric)
- `compare`: column in the same row with the comparison value → shows ▲/▼ %
- `compareLabel`: default "vs previous period"
- `invert`: down is good
- `spark={{ query?, y, x? }}`: small trend line under the value; `query` defaults to the Stat's

### `<LineChart query x? y? series? format? stacked? area? labels?>`
- `x`: category/time column (default: first non-numeric)
- `y`: column or array of columns (default: every numeric column)
- `series`: long-form pivot column (then `y` is one column)
- `area`: wash under the lines; `stacked`: stack series
- `labels={{ col: 'Nice name' }}`: rename series
- Hover: crosshair + tooltip with every series

### `<AreaChart …>`
Same props as LineChart, filled. `stacked` for parts of a whole over time.

### `<BarChart query x? y? series? format? stacked? horizontal? labels?>`
- vertical columns by default; `horizontal` for rankings / long labels (also
  prints each bar's value at its tip when there is one series and ≤ 16 bars)
- several `y` (or a `series`) → grouped bars; add `stacked` to stack

### `<PieChart query label? value? format? maxSlices?>`
Donut with total in the middle and a legend with value and share. Slices
sorted by size; beyond `maxSlices` (default 6) folded into "Other".
Negative/zero values are dropped.

### `<Table query columns? format? sort?>`
- `columns`: `['name', { key: 'revenue', label: 'Revenue', format: 'currency', align: 'right', bar: true }]`
  — `bar` draws an inline bar against the column's max
- `format={{ revenue: 'currency' }}`: formats when `columns` is not given
- `sort`: initial sort, `'revenue'` or `'-revenue'`; headers are click-to-sort
- numbers right-aligned with tabular figures; `id` / `*_id` columns are not grouped
- renders up to 1,000 rows

### `<Text title span? height?>`
Children are ordinary JSX: `<p>`, `<strong>`, `<ul>`, `<a>`.

## Hooks (advanced)

For a custom panel: `useQuery(name)` returns `{ status, run, error, refreshing }`
with `run.result.rows` / `run.result.columns`; `useFilters()` returns the
current values and params. Prefer the built-in panels — `check` cannot verify
what a custom component reads.
