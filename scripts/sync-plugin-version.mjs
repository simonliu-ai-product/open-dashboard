#!/usr/bin/env node
/**
 * Gives the agent plugin the core package's version. Claude Code updates an
 * installed plugin only when its version changes, so it follows core's. Runs
 * after `changeset version` in `pnpm version-packages`.
 *
 *   node scripts/sync-plugin-version.mjs <core package dir> <plugin dir>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const [coreDir, pluginDir] = process.argv.slice(2)
if (!coreDir || !pluginDir) {
  process.stderr.write('usage: sync-plugin-version.mjs <core package dir> <plugin dir>\n')
  process.exit(2)
}
const { version } = JSON.parse(readFileSync(path.join(root, coreDir, 'package.json'), 'utf8'))
for (const file of ['plugin.json', '.claude-plugin/plugin.json']) {
  const target = path.join(root, pluginDir, file)
  const text = readFileSync(target, 'utf8')
  writeFileSync(target, text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`))
}
process.stdout.write(`plugin version → ${version}\n`)
