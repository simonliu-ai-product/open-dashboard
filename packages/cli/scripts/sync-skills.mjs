#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Copies the skills out of core and into the scaffolder's template.
 *
 * They cannot be resolved at init time: `npx @open-dashboard/cli init`
 * installs the scaffolder alone, so core is not on disk yet — and a workspace
 * scaffolded without skills has no /create-dashboard, which is most of the point.
 *
 * They land in `template/skills` rather than `template/.claude/skills` because
 * npm drops dot-directories from a package; `init` copies them into both
 * conventions.
 */
const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', '..', 'core', 'skills')
const target = join(here, '..', 'template', 'skills')

if (!existsSync(source)) {
  process.stderr.write(`cannot find core's skills at ${source}\n`)
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
process.stdout.write(`synced skills into ${target}\n`)
