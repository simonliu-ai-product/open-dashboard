# open-dashboard plugin

Skills, rules and an MCP server that teach Claude Code and Antigravity to work in an [open-dashboard](../../README.md) workspace.

## What it adds

- **Skills** (copied from `packages/core/skills` by `node scripts/sync-plugin.mjs`): `connect-database`, `document-database`, `create-dashboard`, `dashboard-authoring`, `create-chart`, `create-theme`, `current-dashboard`, `apply-comments`, `set-up-assistant`.
- **MCP server**: `open-dashboard mcp` over stdio — the same tools as `open-dashboard dev --mcp` (list, read and write dashboard files, run named queries, check, render a panel), with hash-checked writes.
- **Rules**: the house rules — named queries only, read `database.md` first, never invent a number.

## Install

Claude Code:

```bash
# Claude Code
/plugin install open-dashboard --marketplace simonliu-ai-product/open-dashboard

# Google Antigravity (IDE, App, or the agy CLI)
agy plugin install https://github.com/simonliu-ai-product/open-dashboard
```

The MCP server runs `npx -p @open-dashboard/core -p @open-dashboard/mcp open-dashboard mcp` in the folder the agent works in.
