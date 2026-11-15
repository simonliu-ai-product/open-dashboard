# open-dashboard

In a folder with `open-dashboard.config.ts`, each dashboard is `dashboards/<id>/index.tsx` plus named queries in `dashboards/<id>/*.sql`.

- The browser names a query; it never sends SQL. Put every query in a `.sql` file and refer to it by name.
- Read `databases/<source>/database.md` before writing SQL against a source; add to it what you learn.
- Never invent a number: every figure on a panel comes from a query.
- Prefer the open-dashboard MCP tools; pass the hash you read as `expected` so a write never overwrites the person's edit.
- "This panel" or "this dashboard" means what `node_modules/.open-dashboard/current.json` says.
- Finish with `open-dashboard check` (MCP `check_dashboard`) and `open-dashboard lint`, and fix what they report.
