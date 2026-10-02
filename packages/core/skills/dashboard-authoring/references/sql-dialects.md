# SQL by dialect

`:from` / `:to` are `'YYYY-MM-DD'` strings, `:to` exclusive. Write each query in its datasource's dialect; where a dialect will not compare text with a date on its own, the section says how to cast. Bucket in SQL and
return the bucket as an ISO date string (`'2026-09-01'`) or `'YYYY-MM'` — the
charts recognise both and label them as dates.

## SQLite

Dates are usually TEXT (`'2026-09-30 14:03:11'` or ISO with `T`). String
comparison works for ISO text, so `ordered_at >= :from AND ordered_at < :to` is
correct.

| Bucket | Expression |
| --- | --- |
| day | `date(ts)` |
| week (Mon) | `date(ts, 'weekday 0', '-6 days')` |
| month | `strftime('%Y-%m', ts)` |
| year | `strftime('%Y', ts)` |
| epoch seconds column | `date(ts, 'unixepoch')` |
| epoch ms column | `date(ts / 1000, 'unixepoch')` |

- Integer division truncates: `1.0 * a / b`.
- Booleans are 0/1: `SUM(status = 'refunded')` counts.
- Previous period of the same length:
  `date(:from, '-' || CAST(julianday(:to) - julianday(:from) AS INTEGER) || ' days')`
- `'now'` is **UTC**; add `'localtime'` when the data is stored in local time:
  `datetime('now', 'localtime')`, `date('now', 'localtime', '-1 day')`.
- Hourly buckets with empty hours filled:

  ```sql
  WITH RECURSIVE hours(hour) AS (
    SELECT strftime('%Y-%m-%d %H:00:00', 'now', 'localtime', '-' || :days || ' days')
    UNION ALL SELECT datetime(hour, '+1 hour') FROM hours
    WHERE hour < strftime('%Y-%m-%d %H:00:00', 'now', 'localtime')
  )
  SELECT h.hour, COALESCE(COUNT(o.id), 0) AS orders
  FROM hours h
  LEFT JOIN orders o ON strftime('%Y-%m-%d %H:00:00', o.ordered_at) = h.hour
  GROUP BY h.hour ORDER BY h.hour;
  ```

## PostgreSQL

| Bucket | Expression |
| --- | --- |
| day | `date_trunc('day', ts)::date` |
| week (Mon) | `date_trunc('week', ts)::date` |
| month | `to_char(date_trunc('month', ts), 'YYYY-MM')` |
| epoch seconds column | `to_timestamp(ts)` |

- `:from` is text; compare as `ts >= :from::date` or `ts >= CAST(:from AS date)`
  if the planner complains about types. `::` casts are safe beside parameters.
- `count(*)` and `sum(int)` are `bigint`, `avg`/`sum(numeric)` are `numeric` —
  both arrive as JavaScript numbers.
- Timezones: `date_trunc('day', ts AT TIME ZONE 'Asia/Taipei')` for local days.
- Previous period: `:from::date - (:to::date - :from::date)`.
- Hourly buckets with gaps filled:
  `SELECT h AS hour, count(o.id) FROM generate_series(date_trunc('hour', now() - interval '7 days'), date_trunc('hour', now()), interval '1 hour') h LEFT JOIN orders o ON date_trunc('hour', o.created_at) = h GROUP BY h ORDER BY h`
- A NULL-able text parameter in `(:region IS NULL OR region = :region)` may need
  a type: `(:region::text IS NULL OR region = :region::text)`.

## MySQL / MariaDB

| Bucket | Expression |
| --- | --- |
| day | `DATE(ts)` |
| week (Mon) | `DATE(ts - INTERVAL WEEKDAY(ts) DAY)` |
| month | `DATE_FORMAT(ts, '%Y-%m')` |
| epoch seconds column | `FROM_UNIXTIME(ts)` |

- Previous period: `DATE_SUB(:from, INTERVAL DATEDIFF(:to, :from) DAY)`.
- `DECIMAL` arrives as a number; dates arrive as strings.
- Integer division already yields decimals (`/`); `DIV` truncates.

## SQL Server (T-SQL)

| Bucket | Expression |
| --- | --- |
| day | `CAST(ts AS DATE)` |
| week (Mon) | `DATEADD(day, -((DATEPART(weekday, ts) + @@DATEFIRST - 2) % 7), CAST(ts AS DATE))` |
| month | `FORMAT(ts, 'yyyy-MM')` (or `DATEFROMPARTS(YEAR(ts), MONTH(ts), 1)`) |
| hour | `DATEADD(hour, DATEDIFF(hour, 0, ts), 0)` |

- `ts >= :from AND ts < :to` works as written; the text converts to the column type.
- Now: `SYSDATETIME()` (server local), `SYSUTCDATETIME()`. Yesterday same time: `DATEADD(day, -1, SYSDATETIME())`.
- Row limit: `SELECT TOP (10) …` or `ORDER BY … OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY` — no `LIMIT`.
- Integer division truncates: `1.0 * a / b`.
- Previous period: `DATEADD(day, -DATEDIFF(day, :from, :to), :from)`.
- Hourly gap fill: `GENERATE_SERIES` (SQL Server 2022+) or a recursive CTE with `OPTION (MAXRECURSION 0)`.
- Only a single SELECT/WITH statement runs — no temp tables, no `DECLARE`.

## Oracle

| Bucket | Expression |
| --- | --- |
| day | `TRUNC(ts)` |
| week (Mon) | `TRUNC(ts, 'IW')` |
| month | `TO_CHAR(ts, 'YYYY-MM')` |
| hour | `TRUNC(ts, 'HH24')` |

- Parameters are text: `ts >= TO_DATE(:from, 'YYYY-MM-DD') AND ts < TO_DATE(:to, 'YYYY-MM-DD')`
  (`TO_TIMESTAMP` for TIMESTAMP columns).
- Every scalar SELECT needs `FROM dual`. Row limit: `FETCH FIRST 10 ROWS ONLY`. No `AS` before table aliases.
- Unquoted names are upper-case in Oracle and are folded back to lower case in
  results, so `AS revenue` → `revenue`. A quoted mixed-case alias stays as written.
- Now: `SYSDATE` (a DATE, server time), `SYSTIMESTAMP`. Yesterday same time: `SYSDATE - 1`.
- Previous period: `TO_DATE(:from, 'YYYY-MM-DD') - (TO_DATE(:to, 'YYYY-MM-DD') - TO_DATE(:from, 'YYYY-MM-DD'))`.
- Series / gap fill: `SELECT LEVEL … FROM dual CONNECT BY LEVEL <= n`.
- Empty strings are NULL in Oracle.

## DuckDB

| Bucket | Expression |
| --- | --- |
| day | `CAST(ts AS DATE)` or `date_trunc('day', ts)` |
| week (Mon) | `date_trunc('week', ts)` |
| month | `strftime(ts, '%Y-%m')` |
| hour | `date_trunc('hour', ts)` |

- `ts >= CAST(:from AS DATE) AND ts < CAST(:to AS DATE)`.
- Files are tables: `FROM 'data/orders.parquet'`, `FROM read_csv_auto('data/x.csv')` —
  paths relative to the workspace. Prefer views set up in the datasource's `init`.
- Now: `now()` (timestamp with zone) / `current_date`. Gap fill: `range(start, stop, INTERVAL 1 HOUR)`.
- Previous period: `CAST(:from AS DATE) - (CAST(:to AS DATE) - CAST(:from AS DATE))`.

## ClickHouse

| Bucket | Expression |
| --- | --- |
| day | `toDate(ts)` |
| week (Mon) | `toMonday(ts)` |
| month | `formatDateTime(ts, '%Y-%m')` (or `toStartOfMonth(ts)`) |
| hour | `toStartOfHour(ts)` |

- Parameters arrive typed by value (text → `String`): compare with
  `ts >= toDateTime(:from) AND ts < toDateTime(:to)` (`toDate` for Date columns).
- `(:region IS NULL OR region = :region)` works — "All" binds a `Nullable(String)` NULL.
- Now: `now()` (server time zone; `now('Asia/Taipei')` for a specific one).
- Gap fill: `GROUP BY hour ORDER BY hour WITH FILL STEP INTERVAL 1 HOUR`, or `numbers(n)`.
- Aggregates are fast; still return tens–hundreds of rows, not raw events.
- 64-bit integers beyond 2⁵³ come back as strings (exactness over convenience).

## BigQuery (GoogleSQL)

| Bucket | Expression |
| --- | --- |
| day | `DATE(ts)` |
| week (Mon) | `DATE_TRUNC(DATE(ts), ISOWEEK)` |
| month | `FORMAT_DATE('%Y-%m', DATE(ts))` |
| hour | `TIMESTAMP_TRUNC(ts, HOUR)` |

- Parameters are STRING and BigQuery does **not** coerce them: write
  `ts >= TIMESTAMP(:from) AND ts < TIMESTAMP(:to)` (`DATE(:from)` for DATE columns).
- Qualify tables as `` `project.dataset.table` `` or set `dataset` on the
  datasource and use bare names.
- **Cost:** each query is dry-run and refused if it would scan more than
  `maximumBytesBilled`. Filter on the partition column (`_PARTITIONDATE`, or the
  table's partition field) inside the time range, and select only the columns used.
  `SELECT *` on a wide table is the usual reason a panel is refused.
- Now: `CURRENT_TIMESTAMP()`, `CURRENT_DATETIME('Asia/Taipei')`.
- Gap fill: `UNNEST(GENERATE_TIMESTAMP_ARRAY(start, end, INTERVAL 1 HOUR))`.
- Previous period: `DATE_SUB(DATE(:from), INTERVAL DATE_DIFF(DATE(:to), DATE(:from), DAY) DAY)`.

## Snowflake

| Bucket | Expression |
| --- | --- |
| day | `TO_DATE(ts)` |
| week (Mon) | `DATE_TRUNC('week', ts)` (week start follows `WEEK_START`) |
| month | `TO_CHAR(ts, 'YYYY-MM')` |
| hour | `DATE_TRUNC('hour', ts)` |

- `ts >= :from AND ts < :to` works; the text converts to the column type.
- Unquoted names are upper-case and are folded back to lower case in results.
- Now: `CURRENT_TIMESTAMP()`; `CONVERT_TIMEZONE('Asia/Taipei', CURRENT_TIMESTAMP())`.
- Gap fill: `TABLE(GENERATOR(ROWCOUNT => 168))` with `SEQ4()`.
- Every refresh wakes the warehouse: prefer `refresh: '5m'` or slower, and pre-aggregated tables for live boards.

## All dialects

- Return one row per bucket even when a bucket is empty only if the reader
  needs to see the gap; otherwise missing buckets simply have no point.
- The current period is partial. For "by month" charts, either say so in the
  `description` or end the range at the start of the current month.
- `LIMIT` rankings in SQL (`ORDER BY revenue DESC LIMIT 10`).
