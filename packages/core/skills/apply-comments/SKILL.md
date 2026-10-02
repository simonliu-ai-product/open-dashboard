---
name: apply-comments
description: Use this skill when the user has left notes on panels in the open-dashboard viewer and wants them applied — "apply my comments", "do the notes I left", "I marked up the dashboard". Walks every `@dashboard-comment` marker, makes the change each asks for, verifies it, and removes the marker.
---

# Apply the notes left in the viewer

The inspector's "Note for your agent" box writes the note into the dashboard
source, directly above the panel it is about:

```tsx
{/* @dashboard-comment: show this per week, and split by channel */}
<LineChart title="Daily revenue" query="daily_revenue" x="day" y="revenue" />
```

## Workflow

1. **Find them.** `rg -n "@dashboard-comment" dashboards/`. If the user named no
   dashboard, use `current-dashboard`, then fall back to all of them.
2. **Read them all before changing anything.** Two notes often describe one
   change, and a later one can contradict an earlier one.
3. **Decide where each change belongs.** Most notes change the SQL, not the JSX:
   "per week" is a different `GROUP BY`; "split by channel" is a `series` column
   in the result *and* `series="channel"` on the panel; "only paid orders" is a
   `WHERE`. "Make it a bar chart", "wider", "percent" are JSX.
4. **Run the changed query** with `open-dashboard query --dashboard <id> --name <query>`
   and look at the rows before wiring them to a panel.
5. **Delete the marker** once the change is made. A stale marker gets applied
   twice.
6. **Ask, do not guess.** If a note is ambiguous ("this looks off"), leave the
   marker, look at the data, and ask what they expected — say what you found.
7. **`pnpm exec open-dashboard check <id>`** must pass before you report back.

## After

One line per note: what you changed. Name anything you left alone, and why.
