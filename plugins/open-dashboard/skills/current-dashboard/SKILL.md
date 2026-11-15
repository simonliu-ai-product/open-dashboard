---
name: current-dashboard
description: Use this skill to find out which dashboard, panel, and filter values the user is looking at in the open-dashboard viewer, so "this chart", "this dashboard", "the one I'm looking at", or an instruction with no dashboard named resolves without asking.
---

# Resolve "this one"

The dev server records what the user is looking at in
`node_modules/.open-dashboard/current.json`:

```json
{
  "id": "sales-overview",
  "title": "Sales overview",
  "panel": "Top 10 products",
  "query": "top_products",
  "params": { "from": "2026-07-05", "to": "2026-10-03", "region": null },
  "url": "http://localhost:5473/d/sales-overview?time=90d",
  "updatedAt": "2026-10-02T09:44:40.000Z"
}
```

Read the file, or `GET http://localhost:5473/__odd/api/current`.

- `id` → `dashboards/<id>/index.tsx` and its `*.sql` files.
- `panel` is set when the user last opened the inspector on a panel — it is the
  panel's `title`. Find the JSX element with that title.
- `query` is the named query behind it, in one of the `.sql` files.
- `params` are the filter values on screen. Use them to reproduce what they see:
  `pnpm exec open-dashboard query --dashboard <id> --name <query> --param from=… --param region=null`.

If the file is missing or `updatedAt` is old, the dev server is probably not
running or the user has not opened a dashboard — ask which one rather than
guessing.
