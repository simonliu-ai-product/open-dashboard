#!/usr/bin/env node
/**
 * Everything that must be true before a release is tagged and published.
 *
 *   node scripts/release-check.mjs
 *
 * Run it after the quality gate (`pnpm check && pnpm typecheck && pnpm test &&
 * pnpm build && pnpm audit --prod`). It does not publish: a version only reaches
 * users once `pnpm -r publish --access public` runs, which needs the maintainer's
 * npm login — a tag without that is a release nobody can install.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(repo, path), 'utf8')
const json = (path) => JSON.parse(read(path))
const run = (cmd, args, cwd = repo) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const PACKAGES = ['core', 'cli', 'mcp']
const pkgs = Object.fromEntries(PACKAGES.map((p) => [p, json(`packages/${p}/package.json`)]))
const version = pkgs.core.version
const problems = []
const ok = []

for (const p of PACKAGES) {
  if (pkgs[p].version !== version)
    problems.push(
      `packages/${p} is ${pkgs[p].version}, core is ${version} — they share one version`,
    )
}
const peer = pkgs.mcp.peerDependencies?.['@open-dashboard/core']
if (peer !== `^${version}`)
  problems.push(`mcp's peerDependency on core is ${peer}, expected ^${version}`)

if (!new RegExp(`^## ${version.replaceAll('.', '\\.')}\\b`, 'm').test(read('CHANGELOG.md')))
  problems.push(`CHANGELOG.md has no "## ${version}" section`)
if (!read('SECURITY.md').includes(`${version}: no known vulnerabilities`))
  problems.push(`SECURITY.md does not record the audit for ${version}`)

if (run('git', ['status', '--porcelain', '--untracked-files=no']))
  problems.push('the working tree has uncommitted changes')
if (run('git', ['tag', '--list', `v${version}`])) problems.push(`tag v${version} already exists`)

const newer = (a, b) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
}
for (const p of PACKAGES) {
  try {
    const published = run('npm', ['view', pkgs[p].name, 'version'])
    if (newer(version, published) <= 0)
      problems.push(`${pkgs[p].name} ${version} is not newer than npm's ${published}`)
    else ok.push(`${pkgs[p].name}: npm has ${published}, this is ${version}`)
  } catch {
    ok.push(`${pkgs[p].name}: not on npm yet`)
  }
}

// What npm would ship, without publishing: the built code and what each package promises.
const MUST_SHIP = {
  core: ['dist/index.mjs', 'dist/cli/bin.mjs', 'bin.js', 'skills/dashboard-authoring/SKILL.md'],
  cli: ['dist/cli.mjs', 'bin.js', 'template/skills/create-dashboard/SKILL.md'],
  mcp: ['dist/index.js'],
}
for (const p of PACKAGES) {
  const listed = JSON.parse(run('npm', ['pack', '--dry-run', '--json'], join(repo, 'packages', p)))
  const files = new Set((listed[0]?.files ?? []).map((f) => f.path))
  const missing = MUST_SHIP[p].filter((f) => !files.has(f))
  if (missing.length) problems.push(`${pkgs[p].name} would ship without ${missing.join(', ')}`)
  else ok.push(`${pkgs[p].name}: ${files.size} files packed`)
  const tests = [...files].filter((f) => /\.test\.tsx?$/.test(f))
  if (tests.length)
    problems.push(`${pkgs[p].name} would ship tests: ${tests.slice(0, 3).join(', ')}`)
}

for (const line of ok) process.stdout.write(`  ✓ ${line}\n`)
for (const line of problems) process.stdout.write(`  ✗ ${line}\n`)
process.stdout.write(
  problems.length
    ? `\nnot ready to release ${version}\n`
    : `\nready: tag v${version}, push, gh release create, then pnpm -r publish --access public\n`,
)
process.exit(problems.length ? 1 : 0)
