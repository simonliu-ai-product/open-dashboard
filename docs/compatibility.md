# Compatibility

A dashboard is meant to keep running for years, so what a release may change in a
workspace is a promise, not a habit. This page is that promise.

## What a workspace depends on

These are the public surface. A change to any of them is a change for every workspace:

| Surface | Examples |
| --- | --- |
| Config | `open-dashboard.config.ts` fields, datasource types and their options |
| Query files | `-- name:` and every header (`source`, `uses`, `cache`, `alert`, `expect`, `description`), `:param` binding, `queries/*.sql` |
| Components | Every exported component and its props, `meta` fields, filter names and the params they bind |
| CLI | Command names, flags, exit codes, `--json` shapes |
| MCP | Tool names and their inputs |
| Built output | The files `build` writes and their shapes (`dashboards.json`, `data/d/<id>/<query>.json`), the host contract in [host-integration.md](host-integration.md) |
| Skills | What the shipped skills tell an agent to write |

Everything else — module paths inside the package, CSS classes, the dev API — may
change in any release.

## Versions

`@open-dashboard/core`, `cli` and `mcp` share one version.

- **Patch** (`0.12.1`): fixes only. Nothing a workspace wrote stops working or changes
  meaning.
- **Minor** (`0.13.0`) while below 1.0: may change the surface above, but only with a
  migration in `open-dashboard upgrade` (`MIGRATIONS` in `src/ops/upgrade.ts`) that
  moves a workspace forward, and a line in [CHANGELOG.md](../CHANGELOG.md) saying
  what changed and why. A change no migration can make for the user ships with a
  `check` or `lint` finding that names it.
- **1.0** and after: the surface above changes only in a major version.

A release is published to npm when it is tagged — a version on GitHub that is not on
npm is one no workspace can install.

## Moving a workspace forward

```bash
pnpm add @open-dashboard/core@latest
pnpm exec open-dashboard upgrade          # what this workspace needs
pnpm exec open-dashboard upgrade --write  # do it
pnpm exec open-dashboard check --all-params
```

`upgrade` refreshes the skills, fixes a `package.json` range that would install the
old version back, runs the migrations between the version recorded in
`package.json` (`openDashboard.version`) and the installed one, and records the new
one. A local patch of the framework (`patchedDependencies`) is left to you: it says
whether the patch still applies.

Patching the framework in a workspace is a sign the release path failed; report the
bug so the fix ships, and drop the patch on the next upgrade.
