import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { staleSkills, syncSkills } from './skills.js'

export interface UpgradeStep {
  id: string
  /** `ok`: nothing to do. `needed`: `--write` does it. `manual`: only the user can decide. */
  status: 'ok' | 'needed' | 'manual'
  message: string
  applied?: boolean
}

export interface UpgradeReport {
  /** The version the workspace last upgraded to, from package.json's `openDashboard.version`. */
  from: string | undefined
  to: string
  steps: UpgradeStep[]
}

/**
 * A change to the workspace a release needs, for the versions before it. Every
 * release that changes what a workspace must contain ships one here, so
 * `open-dashboard upgrade` is the whole path forward — see docs/compatibility.md.
 */
export interface Migration {
  id: string
  /** The first version that needs it: workspaces upgraded from earlier ones run it. */
  since: string
  check(root: string): { needed: boolean; message: string }
  apply(root: string): void
}

export const MIGRATIONS: Migration[] = []

const PACKAGE = '@open-dashboard/core'

type Version = [number, number, number]

function parse(version: string): Version | undefined {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

function compare(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/** Whether `range` admits `version`, for the forms a workspace writes: exact, ^, ~. */
export function admits(range: string, version: string): boolean | undefined {
  const target = parse(version)
  const m = /^\s*([\^~]?)(\d+\.\d+\.\d+)\s*$/.exec(range)
  const base = m ? parse(m[2] ?? '') : undefined
  if (!target || !m || !base) return undefined
  if (m[1] === '') return compare(target, base) === 0
  if (compare(target, base) < 0) return false
  if (m[1] === '~' || base[0] === 0) {
    // ~1.2.3 and ^0.2.3 both stay within the minor version.
    return target[0] === base[0] && target[1] === base[1]
  }
  return target[0] === base[0]
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  openDashboard?: { version?: string }
  pnpm?: { patchedDependencies?: Record<string, string> }
  [key: string]: unknown
}

function readPackage(root: string): PackageJson | undefined {
  const file = join(root, 'package.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PackageJson) : undefined
}

function writePackage(root: string, pkg: PackageJson): void {
  writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`)
}

/** `patchedDependencies` keys for this package, from pnpm-workspace.yaml and package.json. */
function frameworkPatches(root: string, pkg: PackageJson | undefined): string[] {
  const keys = Object.keys(pkg?.pnpm?.patchedDependencies ?? {})
  const yaml = join(root, 'pnpm-workspace.yaml')
  if (existsSync(yaml)) {
    const block =
      /^patchedDependencies:\s*\n((?:[ \t]+.*\n?)*)/m.exec(readFileSync(yaml, 'utf8'))?.[1] ?? ''
    for (const m of block.matchAll(/^[ \t]+['"]?([^'":\s]+@[^'":\s]+)['"]?\s*:/gm)) {
      if (m[1]) keys.push(m[1])
    }
  }
  return keys.filter((key) => key.startsWith('@open-dashboard/'))
}

/**
 * What a workspace needs after `@open-dashboard/core` was upgraded under it.
 * Reads only, unless `write`: then it does every `needed` step and records the
 * version, so the next upgrade knows where it starts.
 */
export function upgradeWorkspace(
  root: string,
  installed: string,
  options: { write?: boolean } = {},
): UpgradeReport {
  const pkg = readPackage(root)
  const from = pkg?.openDashboard?.version
  const steps: UpgradeStep[] = []
  const step = (s: UpgradeStep, apply?: () => void) => {
    if (s.status === 'needed' && options.write && apply) {
      apply()
      s.applied = true
    }
    steps.push(s)
  }

  const stale = staleSkills(root)
  step(
    stale.length
      ? {
          id: 'skills',
          status: 'needed',
          message: `skills older than ${installed}: ${stale.join(', ')} — copy the installed ones in`,
        }
      : { id: 'skills', status: 'ok', message: 'skills match the installed package' },
    () => syncSkills(root),
  )

  const deps = pkg?.dependencies?.[PACKAGE] !== undefined ? 'dependencies' : 'devDependencies'
  const range = pkg?.[deps]?.[PACKAGE]
  const fits = range === undefined ? undefined : admits(range, installed)
  step(
    fits === false
      ? {
          id: 'version-range',
          status: 'needed',
          message: `package.json asks for ${PACKAGE} ${range}, which does not include ${installed} — the next install would go back`,
        }
      : {
          id: 'version-range',
          status: 'ok',
          message: range ? `${PACKAGE} ${range}` : `${PACKAGE} is not in package.json`,
        },
    () => {
      const next = readPackage(root) as PackageJson
      ;(next[deps] as Record<string, string>)[PACKAGE] = `^${installed}`
      writePackage(root, next)
    },
  )

  for (const key of frameworkPatches(root, pkg)) {
    const patched = key.slice(key.lastIndexOf('@') + 1)
    step({
      id: 'local-patch',
      status: patched === installed ? 'ok' : 'manual',
      message:
        patched === installed
          ? `a local patch applies to ${key}`
          : `a local patch of ${key} does not apply to ${installed} — if ${installed} has the fix, drop the patchedDependencies entry and its file; if not, re-create it with pnpm patch and report the bug`,
    })
  }

  const fromVersion = from ? parse(from) : undefined
  for (const migration of MIGRATIONS) {
    const since = parse(migration.since)
    if (fromVersion && since && compare(fromVersion, since) >= 0) continue
    const { needed, message } = migration.check(root)
    step({ id: migration.id, status: needed ? 'needed' : 'ok', message }, () =>
      migration.apply(root),
    )
  }

  if (pkg && from !== installed) {
    step(
      {
        id: 'record-version',
        status: 'needed',
        message: `record ${installed} as openDashboard.version in package.json${from ? ` (was ${from})` : ''}`,
      },
      () => {
        const next = readPackage(root) as PackageJson
        next.openDashboard = { ...next.openDashboard, version: installed }
        writePackage(root, next)
      },
    )
  }

  return { from, to: installed, steps }
}
