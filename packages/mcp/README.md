# @open-dashboard/mcp

**English** · [繁體中文](README.zh-TW.md)

An MCP server for an open-dashboard workspace. Any agent framework that speaks the Model Context Protocol can list, read, query, check and write dashboards — and because it runs on the dev server, the page in the browser reloads as the agent works.

```bash
pnpm add -D @open-dashboard/mcp
pnpm exec open-dashboard dev --mcp
```

```
  open-dashboard  http://localhost:5473/
  mcp: http://localhost:5473/mcp
```

Point a client at `http://localhost:5473/mcp` (Streamable HTTP). Every call is independent — no session handshake — so any client can connect.

### Over stdio

A client that starts its server itself — Claude Desktop, most agent frameworks — runs `open-dashboard mcp` instead. No dev server: the same tools over stdin and stdout.

```json
{
  "mcpServers": {
    "open-dashboard": {
      "command": "/path/to/workspace/node_modules/.bin/open-dashboard",
      "args": ["mcp", "--root", "/path/to/workspace"]
    }
  }
}
```

Add `--allow-sql` for `run_sql`. The workspace is read once at start: restart the client after editing `open-dashboard.config.ts`.

## Tools

| Tool | What it does |
| --- | --- |
| `list_dashboards` | Every dashboard: id, title, panels, the queries they use. Start here. |
| `read_dashboard` | A dashboard's `index.tsx` and `.sql` files, each with a hash. |
| `write_dashboard_file` | Write `index.tsx` or a `<name>.sql`; a new id creates the dashboard. Pass `expected` to change a file. |
| `check_dashboard` | Run every query with the filters' defaults and verify every panel. |
| `run_query` | Run one of a dashboard's named queries, as a panel would. |
| `list_sources` | Every datasource, its type, whether it connects. |
| `read_schema` | Tables, columns, keys and row counts of a datasource. |
| `read_database_doc` / `write_database_doc` | `databases/<source>/database.md`: what the data means. |
| `list_charts` | The built-in panels and the custom charts under `charts/`. |
| `list_themes` / `read_theme` / `write_theme` | Themes under `themes/`, validated field by field. |
| `list_comments` / `add_comment` | Notes left on panels, for a later pass. |
| `current_view` | What the person has open in the viewer: "this dashboard", "this chart". |
| `list_collectors` / `run_collector` | The config's collectors: their last run, and running one now. |
| `run_sql` | Read-only SQL of the agent's own — only with `--allow-sql`. |

## Writing a dashboard

1. `list_sources`, then `read_schema` and `read_database_doc` for the source.
2. `list_charts` — use a built-in panel before writing a new one.
3. `write_dashboard_file` with `queries.sql` (named queries: `-- name: …`), then `index.tsx`.
4. `check_dashboard`, and fix what it reports. The browser has already reloaded.

## Concurrent edits

`read_dashboard`, `read_database_doc` and `read_theme` return a hash per file. Writing an existing file needs it as `expected`: if the file changed meanwhile — the person edited the layout in the viewer, or another agent wrote it — the call is refused with `409` instead of overwriting their work. Read again and reapply.

## Your own SQL: `--allow-sql`

The viewer never sends SQL — a page can only name a query written in a `.sql` file. An agent exploring data wants more, so `open-dashboard dev --allow-sql` (which implies `--mcp`) adds `run_sql`: one statement, any source, in its own dialect. It stays read-only the way every query does — SQLite opened read-only, Postgres in a `READ ONLY` transaction, a write-keyword check where an engine has no such mode — so `DELETE` and `DROP` are refused by the driver. It is off unless asked for, because it lets any local agent on this endpoint read any table.

## Security

- **Loopback only.** Over HTTP, Host and Origin headers are checked against loopback: a page on another origin cannot drive the tools (no DNS rebinding onto a local endpoint), and a request with another host name is refused. Both are `403`, also when `open-dashboard dev --host` exposes the viewer itself.
- **Writes are confined** to `dashboards/<id>/index.tsx`, `dashboards/<id>/*.sql`, `databases/<source>/database.md` and `themes/<id>.json`; ids and file names are validated, and nothing else on disk can be written.
- **Errors are masked** like every other message open-dashboard prints: a connection string or key in an error never reaches the agent.
- Nothing here authenticates a caller. Exposing the endpoint beyond loopback needs a reverse proxy that does.

## Embedding

`open-dashboard dev --mcp` covers the usual case. To mount it yourself, over a workspace you opened:

```ts
import { loadConfig, Workspace } from '@open-dashboard/core/node'
import { createOpenDashboardMcpMiddleware } from '@open-dashboard/mcp'

const workspace = new Workspace(await loadConfig(process.cwd()))
app.use('/mcp', createOpenDashboardMcpMiddleware({ workspace }))
```

`createOpenDashboardMcpHandler` returns the web-standard `{ fetch }` form, for runtimes that take a `Request` and return a `Response`.

## License

MIT
