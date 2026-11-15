---
name: document-database
description: Use this skill to write or update `databases/<source>/database.md` — the notes that tell anyone writing SQL against a datasource what its tables and columns mean, which values to filter on, units, time zones and traps. Use it when the user says "document this database", "write a database.md", "explain these tables", after `/connect-database` connects something new, or when you learned something about the data the file does not say yet (a status value, a unit, a column that means something other than its name). Do NOT use for dashboards — that is `create-dashboard`.
---

# Document a database — `databases/<source>/database.md`

One file per datasource, named after its key in `open-dashboard.config.ts`.
It is to a database what `AGENTS.md` is to a codebase: what a newcomer — you,
next time — needs before writing a query. The Data sources page shows it beside
the schema: table notes on each table's card, column notes under each column.

## The format

```md
# shop

What this database is, where the data comes from, how fresh it is, the time
zone of its timestamps. A few sentences.

## Notes

- **Revenue** = SUM(order_items.quantity * order_items.unit_price) over
  `orders.status = 'paid'`. Shipping is not revenue.
- Refunded and cancelled orders stay in `orders`; filter on `status`.

## Tables

### orders
One row per order.

- `status` — `paid`, `refunded`, `cancelled`.
- `ordered_at` — local wall-clock time as text, no zone.
```

What the page reads from it — everything else is plain Markdown:

- `# <name>` is the title; the text before the first `##` is the overview.
- Every `##` section is shown as written, in the panel beside the tables —
  except **`## Tables`** (or 資料表 / 数据表 / テーブル / 테이블).
- Under `## Tables`, each `### <table>` (`schema.table` where there are schemas)
  goes on that table's card. In its lists, an item that **starts with a
  `` `column` ``** becomes that column's note; other text describes the table.
- Headings, paragraphs, lists, fenced code, `code`, **bold**, links. No HTML,
  no images.

## Write it from the data, not from guesses

```bash
pnpm exec open-dashboard schema <source>
pnpm exec open-dashboard query --source <source> "SELECT status, count(*) FROM orders GROUP BY 1"
pnpm exec open-dashboard query --source <source> "SELECT min(created_at), max(created_at) FROM orders"
```

Look for what a query writer gets wrong without being told:

- **Codes and states**: every value of a status/type column and what each
  means for counting.
- **Units**: cents or dollars, seconds or ms, which currency.
- **Time**: zone, local or UTC, text or timestamp, and the range covered.
- **Joins**: keys that are not declared as foreign keys; columns in two tables
  that share values (`orders.channel` vs `customers.acquisition_channel`).
- **Traps**: soft deletes, test accounts, duplicated rows, a column whose name
  lies.
- **Metric definitions** the business uses ("active customer", "revenue").

Write only what the data shows or the user told you. When a meaning is a guess,
ask — or mark it `(unconfirmed)` and say so in your reply. Never invent a value.

Keep it short: a note per column that needs one, not one per column. Columns
whose names say everything (`id`, `created_at` in UTC) need nothing.

## Keep it current

When writing a dashboard teaches you something about the data that the file
does not say, add it. The page reloads it live.

## Report

Say what you wrote, and list anything marked unconfirmed for the user to check.
