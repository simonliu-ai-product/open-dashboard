# __NAME__

An open-dashboard workspace.

```bash
pnpm install
pnpm dev        # http://localhost:5473
```

Then ask your coding agent:

> /connect-database — use the Postgres in WAREHOUSE_URL
>
> /create-dashboard — weekly signups by plan, MRR trend, and the top 20 accounts by usage

## Layout

| Path | What |
| --- | --- |
| `dashboards/<id>/index.tsx` | a dashboard's layout |
| `dashboards/<id>/*.sql` | its named queries |
| `open-dashboard.config.ts` | datasources |
| `.env` | connection strings (git-ignored) |
