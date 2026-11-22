#!/usr/bin/env node
/**
 * What the next release holds: the changesets waiting on this branch, the
 * version each package would get, and the pull request each change came
 * from. Used by .github/workflows/upcoming.yml to keep the "Upcoming
 * release" issue current and to tell a merged pull request where it ships.
 *
 *   node scripts/upcoming-release.mjs --issue
 *   node scripts/upcoming-release.mjs --comment [--files .changeset/a.md,.changeset/b.md]
 *   node scripts/upcoming-release.mjs --json
 *
 * No dependencies: it reads .changeset/*.md and package.json files itself and
 * follows changesets' rules for bumps, `fixed` and `linked` groups.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const args = process.argv.slice(2)
const mode = args.includes('--issue') ? 'issue' : args.includes('--comment') ? 'comment' : 'json'
const filesArg = args.includes('--files') ? (args[args.indexOf('--files') + 1] ?? '') : null

const RANK = { none: 0, patch: 1, minor: 2, major: 3 }

/** Every published package in the repo, by name. */
function workspacePackages() {
  const found = new Map()
  const visit = (dir, depth) => {
    const file = path.join(dir, 'package.json')
    if (existsSync(file) && dir !== root) {
      const pkg = JSON.parse(readFileSync(file, 'utf8'))
      if (pkg.name && !pkg.private) found.set(pkg.name, { version: pkg.version, dir })
    }
    if (depth === 0) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        visit(path.join(dir, entry.name), depth - 1)
      }
    }
  }
  for (const base of ['packages', 'apps'])
    if (existsSync(path.join(root, base))) visit(path.join(root, base), 1)
  return found
}

/** Changesets waiting on this branch: which packages, how far, and what they say. */
export function readChangesets(dir = path.join(root, '.changeset')) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((file) => {
      const text = readFileSync(path.join(dir, file), 'utf8')
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
      if (!match) return null
      const bumps = {}
      for (const line of match[1].split(/\r?\n/)) {
        const m = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch|none)\s*$/.exec(line)
        if (m) bumps[m[1].trim()] = m[2]
      }
      const summary = match[2]
        .trim()
        .split(/\r?\n\s*\r?\n/)[0]
        .replace(/\s+/g, ' ')
      return { file: `.changeset/${file}`, bumps, summary }
    })
    .filter(Boolean)
}

export function nextVersion(version, bump) {
  const [major, minor, patch] = version.split('-')[0].split('.').map(Number)
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`
  return version
}

/** The release these changesets add up to, with changesets' `fixed` and `linked` rules. */
export function plan(changesets, packages, config = {}) {
  const ignore = new Set(config.ignore ?? [])
  const bump = new Map()
  for (const cs of changesets) {
    for (const [name, level] of Object.entries(cs.bumps)) {
      if (!packages.has(name) || ignore.has(name)) continue
      if (RANK[level] > RANK[bump.get(name) ?? 'none']) bump.set(name, level)
    }
  }
  // Fixed: the whole group moves together, to the highest bump any member has.
  for (const group of config.fixed ?? []) {
    const top = group.reduce(
      (best, n) => (RANK[bump.get(n) ?? 'none'] > RANK[best] ? bump.get(n) : best),
      'none',
    )
    if (top !== 'none') for (const n of group) if (packages.has(n)) bump.set(n, top)
  }
  // Linked: members that are released share the highest bump among them.
  for (const group of config.linked ?? []) {
    const released = group.filter((n) => bump.has(n))
    const top = released.reduce(
      (best, n) => (RANK[bump.get(n)] > RANK[best] ? bump.get(n) : best),
      'none',
    )
    for (const n of released) bump.set(n, top)
  }
  return [...bump]
    .filter(([, level]) => level !== 'none')
    .map(([name, level]) => {
      const from = packages.get(name).version
      return { name, from, to: nextVersion(from, level), bump: level }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** The pull request a changeset arrived in, from the squash commit that added it. */
function sourceOf(file) {
  try {
    const subject = execFileSync(
      'git',
      ['log', '--diff-filter=A', '--format=%s', '-1', '--', file],
      {
        encoding: 'utf8',
      },
    ).trim()
    const pr = /\(#(\d+)\)\s*$/.exec(subject)
    return pr ? `#${pr[1]}` : null
  } catch {
    return null
  }
}

function readConfig() {
  const file = path.join(root, '.changeset', 'config.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}

const packages = workspacePackages()
const config = readConfig()
const all = readChangesets()
const release = plan(all, packages, config)
const table = (rows) =>
  [
    '| Package | Now | Next |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| \`${r.name}\` | ${r.from} | **${r.to}** (${r.bump}) |`),
  ].join('\n')

if (mode === 'json') {
  console.log(JSON.stringify({ release, changesets: all }, null, 2))
} else if (mode === 'issue') {
  const lines = [
    '<!-- upcoming-release: kept up to date by .github/workflows/upcoming.yml; edits here are overwritten -->',
    'What is merged into `nightly` and waiting for the next release. Nothing here is on npm yet: a release happens when `nightly` is merged into `main` and the "Version Packages" pull request is merged.',
    '',
  ]
  if (release.length === 0) {
    lines.push('Nothing is waiting: `nightly` has no changes that would publish a new version.')
  } else {
    lines.push('## Versions', '', table(release), '', '## Changes', '')
    for (const cs of all) {
      const pkgs = Object.entries(cs.bumps)
        .filter(([n]) => packages.has(n))
        .map(([n, l]) => `${n} ${l}`)
        .join(', ')
      const from = sourceOf(cs.file)
      lines.push(`- ${cs.summary}${from ? ` (${from})` : ''} — _${pkgs}_`)
    }
  }
  console.log(lines.join('\n'))
} else {
  const mine =
    filesArg === null
      ? all
      : all.filter((cs) =>
          filesArg
            .split(',')
            .map((f) => f.trim())
            .includes(cs.file),
        )
  if (mine.length === 0) {
    console.log(
      'Merged into `nightly`. This pull request has no changeset, so it does not change a published package (docs, CI or tests) and ships with no version of its own.',
    )
  } else {
    const names = new Set(mine.flatMap((cs) => Object.keys(cs.bumps)))
    const mineRelease = release.filter(
      (r) =>
        names.has(r.name) ||
        (config.fixed ?? []).some((g) => g.includes(r.name) && g.some((n) => names.has(n))),
    )
    console.log(
      [
        'Merged into `nightly`. Planned for the next release:',
        '',
        table(mineRelease),
        '',
        'Not published yet: it goes out when `nightly` is merged into `main` and the release pull request is merged. The version can still move up if later changes need a bigger bump. The "Upcoming release" issue lists everything waiting.',
      ].join('\n'),
    )
  }
}
