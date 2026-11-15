# An in-app agent panel for open-dashboard — evaluation and plan

open-doc added an agent panel in the viewer (#82 Codex, #92 Antigravity preview, #86 checks after a turn): the reader types a request beside the page, a coding agent running on their own machine edits the workspace, and the page reloads as it writes. open-dashboard has an *assistant* (`ops/assistant.ts`) that answers questions from the page and may switch filters — it never writes. This note is about bringing the writing agent over.

## What open-doc's panel is

About 8,200 lines (with tests), in three layers:

| Layer | Files | Specific to documents? |
| --- | --- | --- |
| Providers | `agent/providers/{codex,antigravity,antigravity-local}.ts`, `provider.ts`, `detect.ts`, `install.ts`, `sdk-types.ts` | No. They spawn `@openai/codex-sdk` beside a signed-in Codex CLI, or Antigravity on the user's Gemini key, and stream `ProviderEvent`s. |
| Runner and state | `runner.ts`, `store.ts`, `consent.ts`, `status.ts`, `sandbox-sync.ts` | Barely: `runner.ts` passes `docsDir` / `docDir` as the writable roots. |
| Prompting and checking | `prompt.ts`, `check-after-turn.ts` | Yes: document paths, `open-doc check`, the page preview URL. |
| Server route | `vite/routes/agent.ts` (status, connect, consent, turn as NDJSON, cancel, history) | Mostly not: it mounts the runner on the dev server. |
| UI | `app/components/agent/*` (dock, panel, transcript, connect view, history), `app/lib/agent/use-agent.ts`, `agent-bridge.ts`, i18n | Mostly not; it reads the current document for context. |

Policies that must carry over unchanged: no Claude Code (a third-party product may not run on a reader's claude.ai login), Antigravity only on the user's own Gemini key, explicit consent before the first turn, writable roots limited to the content folders, and edits elsewhere asking first.

## What open-dashboard would need

1. **A framework profile instead of document constants.** The runner and prompt take `{ name, contentDir: 'dashboards', entry: 'index.tsx', extraWritable: ['charts', 'themes', 'databases'], check: 'open-dashboard check', lint: 'open-dashboard lint', preview(id) }`.
2. **Dashboard context per turn.** Today `current.json` already records the dashboard, the inspected panel and query, and the filter values; the turn prompt should name the dashboard's `index.tsx`, its `.sql` files and the source's `database.md`.
3. **The invariant still holds.** The agent edits `.sql` files on disk; the browser still only names queries. The agent's own shell may run `open-dashboard query`, as the CLI already allows.
4. **Checks after a turn** (#86): run `open-dashboard check <id>` (and `lint`) when the turn ends, and feed failures back as a follow-up prompt, exactly as open-doc does for sandboxes that cannot run Chromium. For dashboards this matters more: a wrong column name only shows up when the query runs.
5. **The assistant stays.** It answers readers from results and never writes; the agent panel is an authoring tool and hides in `serve` and snapshots (`readOnly()`), like edit mode.

## Plan

| Phase | Work | Size |
| --- | --- | --- |
| 1 | Move providers, runner, store, consent, detect, install and sandbox sync out of open-doc into a shared package (`@open-x/agent`), parameterised by the framework profile; open-doc keeps its behaviour and tests. | Large, but mechanical; open-doc's 413-line runner test and provider tests move with it. |
| 2 | open-dashboard: mount the route on the dev server (`/__odd/api/agent/*`), the dashboard profile, context from `current.json`, check-after-turn with `check` + `lint`. | Medium |
| 3 | UI: the dock and panel as React components from the shared package, themed with `--odd-*` tokens, strings in the five dictionaries (`i18n.test.ts` enforces it). | Medium |
| 4 | open-slide and open-spreadsheet take the same package (open-spreadsheet's grid is not React: it would embed the panel as a small React island or use a plain-DOM build). | Medium |

Doing phase 2 by copying the files instead of sharing them would be quicker once, but it would fork the consent and sandbox rules, which are exactly the parts that must not drift. Phase 1 first.

## Status

Evaluated 2026-11-15; not started. Phase 1 changes open-doc's package layout and its release, so it waits for the maintainers' go-ahead.
