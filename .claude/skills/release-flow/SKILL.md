---
name: release-flow
description: How changes reach npm in open-dashboard — branch rules (feat/fix/chore → main; latest = what is published), when and how to write a changeset, what to say when merging, and how a release is decided and cut. Use when starting a change, opening or merging a pull request, writing a changeset, or when someone asks to release, publish or bump a version.
---

# Release flow

Releases are deliberate. Changes collect on `main`; a release happens when the maintainer decides the collected set is worth shipping and merges the release pull request — never because one pull request merged.

## Branches

| Branch | Holds | Who writes to it |
| --- | --- | --- |
| `main` (default) | Everything merged, released or waiting for the next release. CI checks it; nothing publishes until the release pull request merges. | Pull requests only. |
| `latest` | Exactly what was last published to npm. Agent plugins install from here, so they never run ahead of the packages. | Only the Release workflow, after a publish. Never push to it. |
| `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>` | One change in progress. | You. Branch from `main`, open the pull request back into `main`. |

Each published version also gets a git tag and a GitHub release.

## Making a change

1. `git switch main && git pull`, then `git switch -c feat/<topic>` (or `fix/`, `chore/`, `docs/`).
2. Commit with imperative subjects of 72 characters or fewer.
3. **Add a changeset** if the change alters what a published package does or ships: `pnpm changeset`, pick the packages and the bump.
   - `patch`: a fix; nothing anyone relies on changes.
   - `minor`: a feature, or (below 1.0) anything that changes the public surface — CLI flags, MCP tools, file formats, exported APIs, the host contract, the shipped skills.
   - `major`: only when the maintainer decides to.
   - The summary is release notes for users: what changed and why it matters to them. No internal file names, no ticket chatter.
   - Docs, CI, tests and the demo app need no changeset.
4. Run the checks before opening the pull request: `pnpm check && pnpm typecheck && pnpm test && pnpm build`.
5. Open the pull request into `main`. The body says what changed and why, which checks ran, and whether there is a changeset (or why not).
6. Merge with **squash**, so the commit on `main` ends with `(#N)` — the release notes link back to it.

## When merging: say where it ships

Every pull request merged into `main` gets a comment naming the version it is planned for, e.g. "Planned for the next release: `@open-dashboard/core` 0.4.2 → **0.5.0**". `.github/workflows/upcoming.yml` posts it. If that workflow did not run (or failed), post it yourself:

```bash
node scripts/upcoming-release.mjs --comment --files .changeset/<file>.md[,…] > /tmp/c.md
gh pr comment <N> --body-file /tmp/c.md
```

The same workflow keeps the pinned **"Upcoming release"** issue current on every push to `main`: the versions the next release would publish and one line per change. The release bot's "chore: release packages" pull request shows the same set as version bumps and CHANGELOG text. To read it locally: `node scripts/upcoming-release.mjs --issue`.

## Deciding to release

Never merge the release pull request on your own; propose it to the maintainer when these hold:

- The changes waiting on `main` make a set worth announcing (a theme, not a grab bag), as the "Upcoming release" issue shows.
- `main` CI is green.
- The new behaviour has been used for real — a dev server, a linked workspace, a host app — not only in tests.
- Docs, READMEs and the shipped skills describe it.
- Nothing half-finished is on `main`: unfinished work stays on its branch until it is ready.

## Cutting a release

1. Read the open **"chore: release packages"** pull request the Release workflow keeps up to date: version bumps and CHANGELOG entries written from the changesets. Fix wording by pushing to that pull request's branch.
2. The maintainer merges it. CI then publishes to npm with **trusted publishing** (no tokens, no local `npm login`), creates the git tags and GitHub releases, and moves `latest` to the released commit.
3. Check: `npm view @open-dashboard/core version`, and that `latest` points at the release commit.

Never publish from a laptop (`npm publish`, `pnpm publish`) and never push `latest` by hand. If CI cannot publish, fix the workflow or the trusted-publisher setting on npmjs.com.

## A fix that cannot wait

Releases come only from `main`, so keep `main` releasable: merge a feature only when it is ready to ship. An urgent fix then goes through `main` like any change (with a `patch` changeset), and the maintainer merges the release pull request right away. If `main` does hold something that must not ship yet, stop and ask the maintainer — finish it, revert it, or plan a one-off release — rather than working around the flow.

## This repository

- Published packages: `@open-dashboard/core`, `@open-dashboard/cli`, `@open-dashboard/mcp`. They share one version (a `fixed` group in `.changeset/config.json`): a changeset for any of them moves all three, so name the package the change is in and let the group follow.
- A change to the public surface (`docs/compatibility.md`: CLI, MCP tools, workspace files, built output, the host contract, skills) is `minor` below 1.0 and ships with its migration in `ops/upgrade.ts`, or a `check`/`lint` finding when no code can make the change.
- Changesets write `packages/*/CHANGELOG.md`; the root `CHANGELOG.md` is the history up to 0.13.1.
- Before merging the release pull request, run the quality gate from CLAUDE.md ("Release, Browser Verification & Launch Media Workflow", steps 1–2): add `pnpm audit --prod`, update the audit line in `SECURITY.md`, and verify the sample workspace in a real browser. Steps 4–5 there (promo video, social posts) are for releases worth announcing.
- `node scripts/release-check.mjs` on the release pull request's branch checks that each package packs what it must (the CLI's template skills included).
- `pnpm version-packages` runs `changeset version`, syncs the plugin's version and refreshes the lockfile; `pnpm release` builds `packages/*` and runs `changeset publish`.
- The agent plugin installs from the `latest` branch, never from `main`: `.claude-plugin/marketplace.json` lists it as a `git-subdir` source with `ref: "latest"`, and Antigravity users install `https://github.com/simonliu-ai-product/open-dashboard/tree/latest`. Its version follows core's (`scripts/sync-plugin-version.mjs`, run by `pnpm version-packages`), because Claude Code updates an installed plugin only when that version changes.
