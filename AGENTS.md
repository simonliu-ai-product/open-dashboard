# AGENTS.md

Read [CLAUDE.md](CLAUDE.md) — it is the guide for this repository, for every agent.

## Standard End-to-End Development & Release Workflow (SOP)

When implementing new features and shipping a release for `open-dashboard`, follow this 5-stage pipeline:

### 1. Implementation & Docs Sync
- Implement all core logic in `packages/core/src/ops/` first, then wire thin shells in `vite/api-plugin.ts`, `cli/bin.ts`, and `packages/mcp/src/tools.ts`.
- Add translations for every new UI string across all 4 locale dictionaries (`runtime/i18n-{zh-tw,zh-cn,ja,ko}/{app,panels}.ts`).
- Update built-in skills in `packages/core/skills/dashboard-authoring/` (`SKILL.md`, `references/components.md`).
- Update both `README.md` (English) and `README.zh-TW.md` (Traditional Chinese).

### 2. CLI & Automated Verification
- Run the full quality gate in `tools/open-dashboard`:
  ```bash
  pnpm check && pnpm typecheck && pnpm test && pnpm build && pnpm audit --prod
  ```
- Verify new features in the sample playground (`tools/playground/open-dashboard-sample`) using `open-dashboard check` and any new CLI subcommands (e.g., `--dry-run`, `diff`, `report`).

### 3. Real Browser (Playwright Chromium) UI/UX & Experience Evaluation
- Launch the playground dev server (`rm -rf node_modules/.vite && pnpm dev --port 4321`) and drive headless Chromium via Playwright (`NODE_PATH=/Users/simonliuyuwei/workspace/tools/open-dashboard/node_modules node --input-type=module`) to interact with the real UI and capture high-resolution screenshots.
- Explicitly evaluate and report on 3 dimensions with embedded screenshot proof:
  1. **UI/UX Layout Quality (排版是否 OK)**: Verify alignment, spacing, dark/light contrast, badge placement, and drawer/modal overlays.
  2. **Functional Correctness (功能是否正常)**: Verify URL query param sync, SQL parameter binding, live KPI recalculation, interactive drawers/modals, and confirm `0` Console/Page errors.
  3. **User Experience (是否能夠有好的體驗)**: Verify end-to-end flow smoothness, keyboard shortcuts (`⌘K`, `ESC`), and visual feedback.

### 4. Version Bump, GitHub Release & npm
- Bump version numbers in `packages/core/package.json`, `packages/cli/package.json`, `packages/mcp/package.json` (including `peerDependencies`), `SECURITY.md`, and add the version's section to `CHANGELOG.md`. A change to the public surface in `docs/compatibility.md` ships with a migration in `src/ops/upgrade.ts`.
- Run `pnpm build` (which also syncs skills into `packages/cli/template/skills`), commit `Release <version>`, run `node scripts/release-check.mjs` until it reports ready, tag `v<version>`, push to `origin main` + `--tags`, and create the GitHub Release via `gh release create v<version>`.
- The maintainer publishes from the tag with `pnpm -r publish --access public` (npm login + 2FA) and confirms `npm view @open-dashboard/core version`. Without it the release does not exist for users.

### 5. Live Interaction Promo Video (with Bottom Bilingual Subtitles) & Multi-Platform Social Copy
- **Live Browser Promo Video (`open-dashboard-v<ver>-live-subtitled.mp4`)**:
  - Record real browser interactions in 1920×1080 Chromium via Playwright (`recordVideo`) with a visible cursor + click ripple indicator and a sleek **bottom bilingual subtitle dock (English primary in bold white, Traditional Chinese secondary below)** synchronized to each live feature action, then encode to H.264 MP4 (`ffmpeg -crf 18 -pix_fmt yuv420p`).
  - Save the final MP4 under `tools/playground/open-dashboard-sample/videos/open-dashboard-v<ver>-visual/renders/`.
- **Social Media Copy (4 Platforms)**:
  - Provide ready-to-post copy tailored to platform character limits and tone:
    - **Facebook**: Story-driven hook + numbered feature highlights + GitHub release link + hashtags.
    - **LinkedIn** (ZH-TW & EN): Engineering & architecture perspective + bulleted capabilities.
    - **X (Twitter)** (ZH-TW & EN): Strictly **≤ 280 characters**, punchy bullet points + release URL.
    - **Threads**: Strictly **≤ 500 characters**, conversational and fast-paced summary.


<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
