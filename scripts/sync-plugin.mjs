#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Copies core's canonical skills into the agent plugin. A plugin is installed
 * by cloning this repository, so the folder must carry its own copy;
 * `plugin.test.ts` fails when the two drift.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'packages', 'core', 'skills')
const target = join(root, 'plugins', 'open-dashboard', 'skills')
if (!existsSync(source)) {
  process.stderr.write(`cannot find core's skills at ${source}\n`)
  process.exit(1)
}
rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
process.stdout.write(`synced skills into ${target}\n`)
