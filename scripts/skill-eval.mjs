#!/usr/bin/env node
/**
 * Score a workspace an agent built with the skills.
 *
 *   node scripts/skill-eval.mjs <workspace> [--scenario <id>] [--json]
 *
 * Runs this repo's own CLI (build core first) — `check --all-params` and `lint` —
 * over the workspace and turns what they find into the numbers a skill change is
 * judged by: errors, how many queries carry -- expect: rules, SQL copied between
 * dashboards, slow queries, refresh that no build elsewhere can honour. With
 * --scenario, the bar comes from evals/scenarios.json and the
 * exit code says whether the workspace cleared it.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bin = join(repo, 'packages/core/bin.js')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}
const root = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
if (!root) {
  process.stderr.write(
    'usage: node scripts/skill-eval.mjs <workspace> [--scenario <id>] [--json]\n',
  )
  process.exit(2)
}

const cli = (...command) => {
  try {
    return JSON.parse(
      execFileSync(process.execPath, [bin, ...command, '--json', '--root', resolve(root)], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }),
    )
  } catch (error) {
    // check exits 1 when it finds errors; its report is still on stdout.
    if (error.stdout) return JSON.parse(error.stdout)
    throw error
  }
}

const checks = cli('check', '--all-params')
const lints = cli('lint')

const findings = checks.flatMap((r) => r.findings)
const lintFindings = lints.flatMap((r) => r.findings)
const byRule = (rule) => lintFindings.filter((f) => f.rule === rule).length
const queries = checks.flatMap((r) => r.queries.filter((q) => !q.error))
const withExpect = queries.filter((q) => q.expectations?.length).length

const score = {
  dashboards: checks.length,
  errors: findings.filter((f) => f.severity === 'error').length,
  warnings: findings.filter((f) => f.severity === 'warning').length,
  expectCoverage: queries.length ? Number((withExpect / queries.length).toFixed(2)) : 0,
  duplicates: byRule('duplicate-query'),
  slowQueries: findings.filter((f) => / took \d+ ms \(over /.test(f.message)).length,
  refreshWithoutLive: byRule('refresh-without-live-source'),
  unboundedTables: byRule('unbounded-table-query'),
  failedRuns: checks.reduce((n, r) => n + (r.sweep?.failedRuns ?? 0), 0),
}

const scenarioId = flag('scenario')
let failed = []
if (scenarioId) {
  const scenarios = JSON.parse(readFileSync(join(repo, 'evals/scenarios.json'), 'utf8'))
  const scenario = scenarios.find((s) => s.id === scenarioId)
  if (!scenario) {
    process.stderr.write(`no scenario "${scenarioId}" in evals/scenarios.json\n`)
    process.exit(2)
  }
  const bar = scenario.pass
  failed = Object.entries(bar).filter(([key, limit]) =>
    key.startsWith('min')
      ? score[key[3].toLowerCase() + key.slice(4)] < limit
      : score[key[3].toLowerCase() + key.slice(4)] > limit,
  )
}

if (args.includes('--json')) {
  process.stdout.write(`${JSON.stringify({ score, failed: failed.map(([k]) => k) }, null, 2)}\n`)
} else {
  for (const [key, value] of Object.entries(score)) {
    process.stdout.write(`${key.padEnd(20)} ${value}\n`)
  }
  if (scenarioId) {
    process.stdout.write(
      failed.length
        ? `\n✗ ${scenarioId}: ${failed.map(([k, v]) => `${k} ${v}`).join(', ')}\n`
        : `\n✓ ${scenarioId}\n`,
    )
  }
}
process.exit(failed.length ? 1 : 0)
