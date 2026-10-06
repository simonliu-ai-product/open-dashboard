# Components

All from `@open-dashboard/core`. Every panel takes the common props:

| Prop | Type | |
| --- | --- | --- |
| `title` | string | **required**; unique within the dashboard |
| `description` | string | one line under the title. Only when the user asks for it — definitions go in the query's `-- description:` |
| `span` | 1–12 | width in the row's 12 columns; default: row split evenly |
| `height` | number | px; default: the row's `height`, else the panel's own |
| `drill` | string or object | click a mark to filter by it — see below |

### Drill-down: `drill`

Clicking a bar, line point, pie slice or table row sets a filter to that value;
clicking it again clears it. Marks that do not match the active value dim.

```tsx
<BarChart title="Revenue by region" query="by_region" x="region" y="revenue" drill="region" />
<Table title="Accounts" query="accounts" drill={{ filter: 'account', column: 'account_id' }} />
<BarChart title="By plan" query="by_plan" x="plan" y="mrr" drill={{ filter: 'plan', dashboard: 'plan-detail' }} />
```

- a string names a `<Select>` on this dashboard; the clicked category (x, pie
  label, or the table column of the same name) becomes its value
- `column` reads the value from another column (tables)
- `dashboard` opens that dashboard with the filter set in its URL instead
- a chart that drills should usually **not** be filtered by the same select in
  its own SQL, so every category stays clickable
- `open-dashboard check` warns when `drill` names a filter the dashboard lacks
- drill is off in edit mode

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

### `<ScatterChart query x y series? size? label? format? xFormat?>`
One point per row: how two measures move together.
- `x`, `y`: numeric columns (required); axes do not force zero
- `series`: a column whose values colour the points (≤ 7 groups, the rest "Other")
- `size`: a numeric column → bubbles (area ∝ value)
- `label`: names each point in the tooltip
- `xFormat`: format of x when it differs from y's `format`

### `<Heatmap query x y value format?>`
Cells coloured by `value` on one blue ramp, light → dark, with a scale legend.
Rows and columns appear in the query's order — `ORDER BY` them (weekday
Monday-first, hour 0–23). Empty combinations show as blank cells. `drill`
with `{ filter, column }` filters by the clicked cell's row or column.

### `<FunnelChart query label? value? format?>`
Ordered stages as bars on one scale, each with its share of the first stage
and the step conversion from the stage before. Order the rows in SQL.

### `<Gauge query column? max? target? format?>`
A half-circle meter for one value (first row). `max` and `target` are numbers
or column names in the same row: e.g. `target="last_month"` marks last month on
the arc. With neither, the value is read as a fraction of 1 (a rate).

### `<Treemap query label? value? format? maxItems?>`
Share of a whole across many parts — use it where a pie would need more than
six slices. Tiles sized by value, largest first; past `maxItems` (12) the rest
is "Other".

### Compare and rank

#### `<DotPlot query label? value? format? zero?>`
One row per category, a dot at its value — a ranking on a tight range, where
bars from zero would all look the same length. `value` may be an array: one dot
colour per measure. The axis does not start at zero unless `zero`.

#### `<Dumbbell query label? from to format? labels? zero?>`
Two dots per row joined by a line: before → after, plan → actual. The change is
labelled at the right. `labels={{ from: 'Last month', to: 'This month' }}` names
the ends in the legend.

#### `<SlopeChart query label? from to format? labels? zero?>`
The same data as a Dumbbell, drawn as lines between two columns: better when
the question is *which rose and which fell*. Rises and falls are coloured.

#### `<BulletChart query label? value? target? max? bands? format?>`
Actual against a target, one row per label: a bar, a target tick, grey
qualitative bands behind. `target`, `max` and each of `bands` are numbers or
column names (`bands={['poor', 'fair']}`, low to high). Prefer it to a Gauge
whenever there is more than one value.

#### `<DivergingBar query label? value? format? invert?>`
Signed values from a zero line — variance, growth, net change. Above zero is
blue, below red; `invert` swaps them where below zero is good.

#### `<Marimekko query x series value format?>`
A 100 % stacked bar whose columns are as wide as their share of the total:
size of each group and its mix at once (region width × channel mix).

#### `<BumpChart query x series value ascending? top? format?>`
Rank over time: one line per entity, rank 1 at the top. Rows are long-form
(`x`, `series`, `value`) in period order; ranks are computed per period.
`ascending` ranks the lowest first; `top` (8) hides entities that never reach
that rank.

#### `<Waterfall query label? value? type? total? format?>`
How a start becomes an end: each row a signed step, floating from the running
total. Rows whose `type` column is `'total'` are drawn from zero (an opening
and a closing total); without `type`, a closing total named `total` is appended.

### Over time

#### `<CalendarHeatmap query x value? format?>`
One square per day ('YYYY-MM-DD'), weeks as columns — daily patterns over a
year. Missing days are blank, not zero.

#### `<SmallMultiples query x y series kind? independent? format?>`
One small chart per `series` value, sharing one y scale so they compare
directly (`independent` gives each its own).
`kind`: `'line'` (default), `'area'`, `'bar'`. Use it instead of a LineChart
with more than four or five crossing lines.

#### `<BandChart query x y low high low2? high2? format?>`
A line inside a shaded range: a median within p25–p75, a forecast within its
interval. `low2` / `high2` add a lighter outer band (p5–p95). Compute the
columns in SQL.

#### `<ControlChart query x y center? upper? lower? format?>`
A measure over time against its centre line and control limits; points outside
are marked and counted. Without `center` / `upper` / `lower` columns, the limits
are mean ± 3σ of the data shown.

#### `<HorizonChart query x series y bands? format?>`
Many series over one time axis in little height: each row folds its values
into `bands` (3) layers of darker blue. Good for 5–30 hosts, stores or regions.
Values must be non-negative.

#### `<Timeline query label start end series? now?>`
Bars from `start` to `end` in lanes by `label` — jobs per worker, a project
plan. `series` colours bars (with a legend); `now` draws the current time.

#### `<Gantt query label start end id? after? progress? milestone? group? series? holidays? now?>`
One row per task, in query order (`ORDER BY` the plan). A date-only `end` is
inclusive: `2026-10-01` to `2026-10-03` is three days. `group` gathers a phase's
tasks under a summary bar. `after` is a column of predecessor ids,
comma-separated, matched against `id` (default `label`): it draws
finish-to-start arrows, and a task that starts before its predecessor ends gets
a red dashed arrow and is counted in the legend. `progress` is 0–1 (0–100 is
read as a percentage). A row with no `end`, or a truthy `milestone` column, is a
diamond. Weekends are shaded; `holidays` names a second query of days off —
`date` (YYYY-MM-DD or YYYYMMDD), optional `name`, and an `isHoliday` column
whose false rows make a weekend a working day — and the tooltip then counts
working days. Taiwan's calendar is an `http` table:
`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/2026.json` (one table per
year).

#### `<Candlestick query x open high low close convention? format?>`
Open / high / low / close per period. Rising colour follows the locale
(red-up for zh, ja, ko); `convention="west"` or `"east"` overrides.

### Distribution

#### `<Histogram query value? bin? count? bins? format?>`
How values spread. Pass raw rows (`value`, one per observation; bins are chosen
automatically, or `bins`) or pre-binned rows (`bin`, `count`). Raw rows are
capped like any result — past ~5,000 observations, bin in SQL.

#### `<BoxPlot query value? label? stats? format?>`
Median, quartiles, whiskers (1.5 × IQR) and outliers, one box per `label`
(≤ 20). Raw values, or precomputed
`stats={{ min: 'p0', q1: 'p25', median: 'p50', q3: 'p75', max: 'p100' }}`.

#### `<StripPlot query value label? format?>`
Every observation as a dot, jittered, with the median marked — for small
samples (tens to a few hundred) where a box hides too much.

#### `<EcdfChart query value series? marks? format?>`
Cumulative share at or below each value; one line per `series` (≤ 8).
`marks={[0.5, 0.9]}` draws percentile guides. Reads "90 % of orders are under
$X" directly, and compares whole distributions without binning.

#### `<ParetoChart query label? value? at? format?>`
Concentration: entities sorted largest first, cumulative share against share of
entities, with "top 20 % hold N %" called out (`at`, default 0.2). Pass every
entity, not a top N.

### Flow and composition

#### `<Sankey query source target value format?>`
Flows between stages. One row per link; a target can be the next stage's
source. Prefix node names by stage if a name appears in two stages
(`'web'` as a source and as a channel). Cycles are refused with a message.

#### `<CohortTable query cohort period value mode? size? format?>`
Retention triangle: one row per cohort (sign-up month), one column per period
since (0, 1, 2…). `mode="percent"` (default) divides by `size` (a column), or
by period 0 without it; `"count"` shows raw numbers.

#### `<UpSetChart query sets value top? format?>`
Overlaps between sets, where a Venn diagram would fail past three: `sets` is a
comma-separated combination (`'Beans,Grinders'`, one row per exact
combination), `value` how many have exactly it. Shows the largest `top` (15).

### Maps

The maps draw from data you give them; nothing is fetched at runtime. Import
GeoJSON beside the dashboard: `import counties from './counties.json'`.

#### `<ChoroplethMap query geo featureKey region value format? scale?>`
Regions shaded by value. `geo` is a FeatureCollection of Polygon /
MultiPolygon features; `featureKey` the feature property holding names; `region`
the column with the same names (matched case-insensitively, 台 = 臺). Regions
without data are grey and counted. `scale="diverging"` for signed values. Large
regions dominate visually — use a TileMap when every region should count equally.

#### `<SymbolMap query lat lng size? label? series? geo? format?>`
A circle per row at its coordinates, area ∝ `size`, coloured by `series`.
`geo` draws an outline underneath. Join coordinates in SQL.

#### `<TileMap query region value format? grid?>`
One equal square per place on a fixed grid: Taiwan's 22 counties and cities by
default (Chinese, English or 台/臺 names), or `grid={{ name: [col, row] }}`.

### Status and tables

#### `<StateTimeline query x series state end? states?>`
State over time per lane — up / degraded / down per service. Each row is a
state starting at `x`, lasting until `end` or the lane's next row.
`states={{ up: 'good', degraded: 'warning', down: 'critical' }}` uses the
status colours; others take series colours. The legend shows each state's share.

#### `<PivotTable query rows columns value agg? format? totals? heat?>`
Cross-tab in the browser from long rows: `rows` (one field or two, nested),
`columns`, `value`, `agg` (`sum` default, `count`, `avg`, `min`, `max`).
Totals by default; `heat` shades cells. Aggregate in SQL first when the raw
rows are many.

### More

#### `<Text title span? height?>`
Children are ordinary JSX: `<p>`, `<strong>`, `<ul>`, `<a>`.

## Hooks (advanced)

For a chart no built-in panel draws, write a custom chart with `defineChart`
under `charts/<id>/` — see the **`create-chart`** skill. It gets the panel
frame, the inspector, download and the theme, and `check` verifies the columns
it declares.

`useQuery(name)` returns `{ status, run, error, refreshing }` with
`run.result.rows` / `run.result.columns`; `useFilters()` returns the current
values and params. Prefer `defineChart` over a bare component built on these —
`check` cannot verify what an undeclared component reads.
