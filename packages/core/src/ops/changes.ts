import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { ResolvedConfig } from '../workspace.js'
import { OpsError } from './errors.js'

const run = promisify(execFile)

export interface WorkspaceFileChange {
  path: string
  status: 'modified' | 'added' | 'deleted'
  additions: number
  deletions: number
  diff: string
}

export interface WorkspaceChanges {
  available: boolean
  branch: string | null
  files: WorkspaceFileChange[]
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd: root,
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

function allowedFolders(config: ResolvedConfig): string[] {
  const dirs = [config.dashboardsDir, 'queries', config.chartsDir, 'themes', 'databases']
  return [...new Set(dirs.map((d) => normalize(d).replace(/\\/g, '/').replace(/\/+$/, '')))]
}

function isAllowedPath(config: ResolvedConfig, relPath: string): boolean {
  const clean = normalize(relPath).replace(/\\/g, '/').replace(/^\.\//, '')
  if (!clean || clean.startsWith('..') || isAbsolute(clean)) return false
  const full = resolve(config.root, clean)
  const rel = relative(config.root, full).split(sep).join('/')
  if (rel.startsWith('..') || isAbsolute(rel)) return false
  const folders = allowedFolders(config)
  return folders.some((folder) => rel === folder || rel.startsWith(`${folder}/`))
}

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

/**
 * Uncommitted Git changes across the workspace's authoring directories
 * (`dashboards/`, `queries/`, `charts/`, `themes/`, `databases/`).
 */
export async function readWorkspaceChanges(config: ResolvedConfig): Promise<WorkspaceChanges> {
  try {
    const inside = (await git(config.root, ['rev-parse', '--is-inside-work-tree'])).trim()
    if (inside !== 'true') return { available: false, branch: null, files: [] }
  } catch {
    return { available: false, branch: null, files: [] }
  }

  let branch: string | null = null
  try {
    branch = (await git(config.root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || null
  } catch {
    branch = null
  }

  const folders = allowedFolders(config).filter((folder) =>
    existsSync(resolve(config.root, folder)),
  )
  if (folders.length === 0) return { available: true, branch, files: [] }

  let statusOut = ''
  try {
    statusOut = await git(config.root, ['status', '--porcelain=v1', '-uall', '--', ...folders])
  } catch {
    return { available: true, branch, files: [] }
  }

  let hasHead = true
  try {
    await git(config.root, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  } catch {
    hasHead = false
  }

  const files: WorkspaceFileChange[] = []
  for (const rawLine of statusOut.split('\n')) {
    if (rawLine.length < 4) continue
    const xy = rawLine.slice(0, 2)
    let filePath = rawLine.slice(3).trim()
    if (filePath.includes(' -> ')) {
      filePath = filePath.split(' -> ').pop()?.trim() ?? filePath
    }
    filePath = filePath.replace(/^"+|"+$/g, '')
    if (!isAllowedPath(config, filePath)) continue

    const isUntracked = xy === '??'
    const isDeleted = xy.includes('D')
    const status: WorkspaceFileChange['status'] =
      isUntracked || xy.includes('A') ? 'added' : isDeleted ? 'deleted' : 'modified'

    let diff = ''
    if (!isUntracked && hasHead) {
      try {
        const out = await git(config.root, ['diff', '--no-color', 'HEAD', '--', filePath])
        const hunkIdx = out.indexOf('@@')
        diff = hunkIdx !== -1 ? out.slice(hunkIdx).trimEnd() : out.trimEnd()
      } catch {
        diff = ''
      }
    } else if (existsSync(resolve(config.root, filePath))) {
      try {
        const content = readFileSync(resolve(config.root, filePath), 'utf8')
        const lines = content.replace(/\n$/, '').split('\n')
        diff = [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join('\n')
      } catch {
        diff = ''
      }
    }

    const { additions, deletions } = countDiffLines(diff)
    files.push({
      path: filePath,
      status,
      additions,
      deletions,
      diff,
    })
  }

  files.sort((a, b) => a.path.localeCompare(b.path))
  return { available: true, branch, files }
}

/**
 * Revert a single uncommitted file in the workspace back to `HEAD`
 * (or remove it if untracked).
 */
export async function revertWorkspaceFile(
  config: ResolvedConfig,
  relPath: string,
): Promise<{ reverted: string }> {
  const clean = normalize(relPath).replace(/\\/g, '/').replace(/^\.\//, '')
  if (!isAllowedPath(config, clean)) {
    throw new OpsError(
      `cannot revert path outside workspace authoring directories: "${relPath}"`,
      400,
    )
  }

  let trackedInHead = false
  try {
    await git(config.root, ['cat-file', '-e', `HEAD:./${clean}`])
    trackedInHead = true
  } catch {
    trackedInHead = false
  }

  if (trackedInHead) {
    await git(config.root, ['checkout', 'HEAD', '--', clean])
  } else {
    try {
      await git(config.root, ['reset', 'HEAD', '--', clean])
    } catch {
      // ignore if not staged
    }
    const full = resolve(config.root, clean)
    if (existsSync(full)) {
      rmSync(full, { force: true })
    }
  }

  return { reverted: clean }
}
