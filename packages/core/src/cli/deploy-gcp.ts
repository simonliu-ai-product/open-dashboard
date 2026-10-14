import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as readline from 'node:readline/promises'
import { loadConfig } from '../workspace.js'

export type DeployMode = 'editable' | 'serve'

export interface GcpDeployFlags {
  project?: string
  region?: string
  service?: string
  bucket?: string
  mode?: DeployMode
  memory?: string
  token?: string
  dryRun?: boolean
  yes?: boolean
  json?: boolean
  delete?: boolean
  pull?: boolean
  skipPull?: boolean
  purgeStorage?: boolean
}

export interface GcpCloudState {
  provider: 'gcp'
  project: string
  region: string
  service: string
  bucket: string
  mode: DeployMode
  memory: string
  mcpToken: string
  serviceUrl?: string
  stopped?: boolean
  updatedAt: string
}

export interface ResolvedGcpDeployOptions {
  userCwd: string
  dashboardsDir: string
  chartsDir: string
  syncedDirs: string[]
  project: string
  region: string
  service: string
  bucket: string
  mode: DeployMode
  memory: string
  mcpToken: string
  packageManager: 'pnpm' | 'npm' | 'yarn'
}

export interface GcpCheckItem {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  remedy?: string
}

export interface GcpCheckReport {
  ready: boolean
  account: string | null
  project: string | null
  accessibleProjects: string[]
  items: GcpCheckItem[]
}

export const REQUIRED_GCP_APIS = [
  'run.googleapis.com',
  'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com',
  'storage.googleapis.com',
] as const

const STATE_FILE = '.open-dashboard-cloud.json'

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
}

export function sanitizeKebab(input: string, fallback = 'open-dashboard-app'): string {
  const cleaned = input
    .toLowerCase()
    .replace(/^@[^/]+\//, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  return cleaned.slice(0, 48).replace(/-+$/g, '') || fallback
}

export function defaultBucketName(project: string, service: string): string {
  const base = `${sanitizeKebab(project, 'gcp')}-${sanitizeKebab(service, 'open-dashboard')}-data`
  return base.slice(0, 63).replace(/-+$/g, '')
}

export function detectPackageManager(userCwd: string): 'pnpm' | 'npm' | 'yarn' {
  const pkgPath = path.join(userCwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { packageManager?: string }
      if (pkg.packageManager?.startsWith('pnpm')) return 'pnpm'
      if (pkg.packageManager?.startsWith('yarn')) return 'yarn'
      if (pkg.packageManager?.startsWith('npm')) return 'npm'
    } catch {
      // fall through
    }
  }
  if (existsSync(path.join(userCwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(userCwd, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

export function inferDefaultServiceName(userCwd: string): string {
  const pkgPath = path.join(userCwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }
      if (pkg.name) return sanitizeKebab(pkg.name)
    } catch {
      // fall through
    }
  }
  return sanitizeKebab(path.basename(userCwd))
}

export function readCloudState(userCwd: string): Partial<GcpCloudState> {
  const file = path.join(userCwd, STATE_FILE)
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<GcpCloudState>
  } catch {
    return {}
  }
}

export function writeCloudState(userCwd: string, state: GcpCloudState): void {
  const file = path.join(userCwd, STATE_FILE)
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  ensureGitignoreEntry(userCwd, STATE_FILE)
}

function ensureGitignoreEntry(userCwd: string, entry: string): void {
  const gitignorePath = path.join(userCwd, '.gitignore')
  if (!existsSync(gitignorePath)) return
  try {
    const content = readFileSync(gitignorePath, 'utf8')
    const lines = content.split(/\r?\n/).map((line) => line.trim())
    if (!lines.includes(entry)) {
      const prefix = content.endsWith('\n') || content.length === 0 ? '' : '\n'
      writeFileSync(gitignorePath, `${content}${prefix}${entry}\n`, 'utf8')
    }
  } catch {
    // ignore read-only or missing gitignore issues
  }
}

export interface CommandResult {
  ok: boolean
  status: number
  stdout: string
  stderr: string
}

export type CommandRunner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; inherit?: boolean },
) => CommandResult

export const defaultRunner: CommandRunner = (cmd, args, opts) => {
  const res = spawnSync(cmd, args, {
    cwd: opts?.cwd,
    stdio: opts?.inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
  })
  return {
    ok: res.status === 0,
    status: res.status ?? 1,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  }
}

export function hasMcpPackageInstalled(userCwd: string): boolean {
  let dir = path.resolve(userCwd)
  for (;;) {
    if (existsSync(path.join(dir, 'node_modules', '@open-dashboard', 'mcp', 'package.json'))) {
      return true
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  const pkgPath = path.join(userCwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      return Boolean(
        pkg.dependencies?.['@open-dashboard/mcp'] || pkg.devDependencies?.['@open-dashboard/mcp'],
      )
    } catch {
      return false
    }
  }
  return false
}

export async function inspectGcpEnvironment(
  userCwd: string,
  flags: GcpDeployFlags = {},
  runner: CommandRunner = defaultRunner,
): Promise<GcpCheckReport> {
  const items: GcpCheckItem[] = []
  const config = await loadConfig(userCwd)
  const state = readCloudState(userCwd)
  const mode: DeployMode = flags.mode ?? config.deploy?.gcp?.mode ?? state.mode ?? 'editable'

  // 1. Check gcloud CLI installation
  const versionRes = runner('gcloud', ['--version'])
  if (!versionRes.ok) {
    items.push({
      id: 'gcloud-cli',
      label: 'Google Cloud SDK (gcloud)',
      status: 'fail',
      detail: 'gcloud CLI is not installed or not in PATH',
      remedy:
        process.platform === 'darwin'
          ? 'Run `brew install --cask google-cloud-sdk` to install the Google Cloud CLI.'
          : 'Install Google Cloud SDK from https://cloud.google.com/sdk/docs/install',
    })
    return {
      ready: false,
      account: null,
      project: null,
      accessibleProjects: [],
      items,
    }
  }
  const firstLine = versionRes.stdout.split(/\r?\n/)[0] ?? 'Google Cloud SDK'
  items.push({
    id: 'gcloud-cli',
    label: 'Google Cloud SDK (gcloud)',
    status: 'ok',
    detail: firstLine,
  })

  // 2. Check active gcloud authentication
  const authRes = runner('gcloud', [
    'auth',
    'list',
    '--filter=status:ACTIVE',
    '--format=value(account)',
  ])
  const account =
    authRes.ok && authRes.stdout ? (authRes.stdout.split(/\r?\n/)[0]?.trim() ?? null) : null
  if (!account) {
    items.push({
      id: 'gcloud-auth',
      label: 'GCP Authentication',
      status: 'fail',
      detail: 'No active Google Cloud account logged in',
      remedy: 'Run `gcloud auth login` in your terminal to sign in.',
    })
  } else {
    items.push({
      id: 'gcloud-auth',
      label: 'GCP Authentication',
      status: 'ok',
      detail: `Signed in as ${account}`,
    })
  }

  // 3. Check accessible projects & resolved project
  const projectsRes = account
    ? runner('gcloud', ['projects', 'list', '--limit=25', '--format=value(projectId)'])
    : { ok: false, status: 1, stdout: '', stderr: '' }
  const accessibleProjects = projectsRes.ok
    ? projectsRes.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const gcloudDefaultProjectRes = runner('gcloud', ['config', 'get-value', 'project'])
  const gcloudDefaultProject =
    gcloudDefaultProjectRes.ok &&
    gcloudDefaultProjectRes.stdout &&
    gcloudDefaultProjectRes.stdout !== '(unset)'
      ? gcloudDefaultProjectRes.stdout.trim()
      : undefined

  const project =
    flags.project ?? config.deploy?.gcp?.project ?? state.project ?? gcloudDefaultProject ?? null

  if (!project) {
    const sample =
      accessibleProjects.length > 0
        ? ` (accessible projects: ${accessibleProjects.slice(0, 5).join(', ')})`
        : ''
    items.push({
      id: 'gcp-project',
      label: 'GCP Target Project',
      status: 'warn',
      detail: `No default GCP project configured${sample}`,
      remedy:
        'Pass `--project <PROJECT_ID>`, set `deploy.gcp.project` in `open-dashboard.config.ts`, or run `gcloud config set project <PROJECT_ID>`.',
    })
  } else {
    items.push({
      id: 'gcp-project',
      label: 'GCP Target Project',
      status: 'ok',
      detail: `Using project "${project}"`,
    })
  }

  // 4. Check required GCP APIs if project is set
  if (project && account) {
    const enabledRes = runner('gcloud', [
      'services',
      'list',
      '--enabled',
      `--project=${project}`,
      '--format=value(config.name)',
    ])
    if (enabledRes.ok) {
      const enabledSet = new Set(
        enabledRes.stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
      const missingApis = REQUIRED_GCP_APIS.filter((api) => !enabledSet.has(api))
      if (missingApis.length === 0) {
        items.push({
          id: 'gcp-apis',
          label: 'Required GCP APIs (Run, Build, Artifact Registry, Storage)',
          status: 'ok',
          detail: 'All 4 required GCP APIs are enabled',
        })
      } else {
        items.push({
          id: 'gcp-apis',
          label: 'Required GCP APIs (Run, Build, Artifact Registry, Storage)',
          status: 'warn',
          detail: `APIs not yet enabled on ${project}: ${missingApis.join(', ')}`,
          remedy:
            '`open-dashboard deploy gcp` will automatically enable these APIs via `gcloud services enable`.',
        })
      }
    }
  }

  // 5. Check @open-dashboard/mcp when in editable mode
  if (mode === 'editable') {
    const hasMcp = hasMcpPackageInstalled(userCwd)
    const pm = detectPackageManager(userCwd)
    const installCmd =
      pm === 'pnpm'
        ? 'pnpm add -D @open-dashboard/mcp'
        : pm === 'yarn'
          ? 'yarn add -D @open-dashboard/mcp'
          : 'npm install -D @open-dashboard/mcp'
    if (hasMcp) {
      items.push({
        id: 'mcp-package',
        label: 'Antigravity Remote MCP (@open-dashboard/mcp)',
        status: 'ok',
        detail: '@open-dashboard/mcp is installed (remote /mcp endpoint ready)',
      })
    } else {
      items.push({
        id: 'mcp-package',
        label: 'Antigravity Remote MCP (@open-dashboard/mcp)',
        status: 'warn',
        detail:
          '@open-dashboard/mcp is not listed in this project; web editing works, but /mcp will be skipped unless installed',
        remedy: `Run \`${installCmd}\` if you want Antigravity to edit cloud dashboards directly over /mcp.`,
      })
    }
  }

  // 6. Confirm Cloud Build removes need for local Docker
  items.push({
    id: 'cloud-build',
    label: 'Container Builder (Google Cloud Build)',
    status: 'ok',
    detail: 'Builds remotely via `gcloud run deploy --source .` (no local Docker required)',
  })

  const hasFail = items.some((i) => i.status === 'fail')
  return {
    ready: !hasFail && Boolean(project),
    account,
    project,
    accessibleProjects,
    items,
  }
}

export function generateEntrypointScript(opts: { syncedDirs: string[]; mode: DeployMode }): string {
  if (opts.mode === 'serve') {
    return [
      '#!/usr/bin/env sh',
      'set -e',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell variable expansion
      'exec npx open-dashboard serve --host 0.0.0.0 --port "${PORT:-8080}"',
      '',
    ].join('\n')
  }

  const dirsList = opts.syncedDirs.map((d) => `"${d}"`).join(' ')
  return [
    '#!/usr/bin/env sh',
    'set -e',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell variable expansion
    'MOUNT_DIR="${OPEN_DASHBOARD_MOUNT_DIR:-/mnt/gcs}"',
    'mkdir -p "$MOUNT_DIR"',
    '',
    '# Ensure node_modules is resolvable when Vite/Node walks up from /mnt/gcs realpaths',
    'if [ -d "/app/node_modules" ] && [ ! -e "$MOUNT_DIR/node_modules" ]; then',
    '  ln -s /app/node_modules "$MOUNT_DIR/node_modules" || true',
    'fi',
    '',
    `for DIR in ${dirsList}; do`,
    '  mkdir -p "$MOUNT_DIR/$DIR"',
    '  if [ -d "/app/.seed/$DIR" ] && [ -z "$(ls -A "$MOUNT_DIR/$DIR" 2>/dev/null)" ]; then',
    '    cp -R "/app/.seed/$DIR/." "$MOUNT_DIR/$DIR/" || true',
    '  fi',
    '  rm -rf "/app/$DIR"',
    '  ln -s "$MOUNT_DIR/$DIR" "/app/$DIR"',
    'done',
    '',
    '# Initialize Git baseline on persistent storage so the Changes diff view works in cloud',
    'if command -v git >/dev/null 2>&1; then',
    '  if [ ! -d "$MOUNT_DIR/.git" ]; then',
    '    git -C "$MOUNT_DIR" init -q || true',
    '    git -C "$MOUNT_DIR" config user.email "cloud@open-dashboard.local" || true',
    '    git -C "$MOUNT_DIR" config user.name "open-dashboard cloud" || true',
    '    git -C "$MOUNT_DIR" add -A || true',
    '    git -C "$MOUNT_DIR" commit -q -m "Initial cloud baseline" --allow-empty || true',
    '  fi',
    '  rm -rf /app/.git',
    '  ln -s "$MOUNT_DIR/.git" /app/.git || true',
    'fi',
    '',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell variable expansion
    'exec npx open-dashboard dev --host 0.0.0.0 --port "${PORT:-8080}" --mcp',
    '',
  ].join('\n')
}

export function generateDockerfile(opts: {
  packageManager: 'pnpm' | 'npm' | 'yarn'
  syncedDirs: string[]
  mode: DeployMode
}): string {
  const installStep =
    opts.packageManager === 'pnpm'
      ? 'RUN corepack enable && pnpm install --no-frozen-lockfile --shamefully-hoist'
      : opts.packageManager === 'yarn'
        ? 'RUN corepack enable && yarn install'
        : 'RUN npm install'

  const dirsList = opts.syncedDirs.map((d) => `"${d}"`).join(' ')
  const lines = [
    'FROM node:22-slim',
    'ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    'RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*',
    'WORKDIR /app',
    'COPY . .',
    installStep,
  ]

  if (opts.mode === 'serve') {
    lines.push('RUN npx open-dashboard serve --build-only')
  } else {
    lines.push(
      `RUN mkdir -p /app/.seed && for DIR in ${dirsList}; do if [ -d "/app/$DIR" ]; then cp -R "/app/$DIR" "/app/.seed/$DIR"; fi; done`,
    )
  }

  lines.push(
    'RUN chmod +x /app/.open-dashboard-entrypoint.sh',
    'ENV NODE_ENV=development',
    'ENV OPEN_DASHBOARD_CLOUD=1',
    'ENV OPEN_DASHBOARD_MOUNT_DIR=/mnt/gcs',
    'ENV PORT=8080',
    'EXPOSE 8080',
    'CMD ["/app/.open-dashboard-entrypoint.sh"]',
    '',
  )

  return lines.join('\n')
}

export function generateDockerignore(): string {
  return [
    'node_modules',
    'dist',
    'site',
    '.git',
    '.DS_Store',
    '.open-dashboard-cloud.json',
    '*.log',
    '',
  ].join('\n')
}

export function buildGcloudDeployArgs(opts: ResolvedGcpDeployOptions): string[] {
  const baseArgs = [
    'run',
    'deploy',
    opts.service,
    '--source',
    '.',
    '--project',
    opts.project,
    '--region',
    opts.region,
    '--execution-environment',
    'gen2',
    '--port',
    '8080',
    '--memory',
    opts.memory,
    '--allow-unauthenticated',
    '--quiet',
  ]

  if (opts.mode === 'editable') {
    baseArgs.push(
      '--max-instances',
      '1',
      '--min-instances',
      '0',
      '--add-volume',
      `name=open-dashboard-storage,type=cloud-storage,bucket=${opts.bucket}`,
      '--add-volume-mount',
      'volume=open-dashboard-storage,mount-path=/mnt/gcs',
      '--set-env-vars',
      `OPEN_DASHBOARD_CLOUD=1,OPEN_DASHBOARD_MOUNT_DIR=/mnt/gcs,OPEN_DASHBOARD_MCP_TOKEN=${opts.mcpToken}`,
    )
  } else {
    baseArgs.push('--set-env-vars', 'OPEN_DASHBOARD_CLOUD=1')
  }

  return baseArgs
}

export function formatAntigravityMcpSnippet(
  service: string,
  serviceUrl: string,
  mcpToken: string,
): string {
  const cleanUrl = serviceUrl.replace(/\/$/, '')
  const snippet = {
    mcpServers: {
      [`${service}-cloud`]: {
        serverUrl: `${cleanUrl}/mcp`,
        headers: {
          Authorization: `Bearer ${mcpToken}`,
        },
      },
    },
  }
  return JSON.stringify(snippet, null, 2)
}

async function promptForProject(accessibleProjects: string[]): Promise<string | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || accessibleProjects.length === 0) {
    return null
  }
  process.stdout.write(`${c.bold('\nSelect a Google Cloud project for deployment:')}\n`)
  accessibleProjects.slice(0, 15).forEach((p, idx) => {
    process.stdout.write(`  ${c.cyan(`${idx + 1})`)} ${p}\n`)
  })
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (
      await rl.question(
        `\nEnter project number (1-${Math.min(15, accessibleProjects.length)}) or project ID: `,
      )
    ).trim()
    if (!answer) return null
    const num = Number(answer)
    if (Number.isInteger(num) && num >= 1 && num <= accessibleProjects.length) {
      return accessibleProjects[num - 1] ?? null
    }
    return answer
  } finally {
    rl.close()
  }
}

export async function resolveGcpDeployOptions(
  userCwd: string,
  flags: GcpDeployFlags = {},
  runner: CommandRunner = defaultRunner,
  allowInteractive = true,
): Promise<ResolvedGcpDeployOptions> {
  const config = await loadConfig(userCwd)
  const gcpCfg = config.deploy?.gcp ?? {}
  const state = readCloudState(userCwd)

  const gcloudDefaultRes = runner('gcloud', ['config', 'get-value', 'project'])
  const gcloudDefault =
    gcloudDefaultRes.ok && gcloudDefaultRes.stdout && gcloudDefaultRes.stdout !== '(unset)'
      ? gcloudDefaultRes.stdout.trim()
      : undefined

  let project = flags.project ?? gcpCfg.project ?? state.project ?? gcloudDefault
  if (!project && allowInteractive) {
    const listRes = runner('gcloud', [
      'projects',
      'list',
      '--limit=15',
      '--format=value(projectId)',
    ])
    const projects = listRes.ok
      ? listRes.stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    project = (await promptForProject(projects)) ?? undefined
  }

  if (!project) {
    throw new Error(
      'Missing GCP project ID. Pass `--project <PROJECT_ID>`, set `deploy.gcp.project` in `open-dashboard.config.ts`, or run `gcloud config set project <PROJECT_ID>`.',
    )
  }

  const region = flags.region ?? gcpCfg.region ?? state.region ?? 'asia-east1'
  const service =
    flags.service ?? gcpCfg.service ?? state.service ?? inferDefaultServiceName(userCwd)
  const bucket =
    flags.bucket ?? gcpCfg.bucket ?? state.bucket ?? defaultBucketName(project, service)
  const mode: DeployMode = flags.mode ?? gcpCfg.mode ?? state.mode ?? 'editable'
  const memory = flags.memory ?? gcpCfg.memory ?? state.memory ?? '1Gi'
  const mcpToken =
    flags.token ??
    process.env.OPEN_DASHBOARD_MCP_TOKEN ??
    state.mcpToken ??
    `odd_mcp_${randomBytes(24).toString('hex')}`

  const dashboardsDir = config.dashboardsDir ?? 'dashboards'
  const chartsDir = config.chartsDir ?? 'charts'
  const syncedDirs = Array.from(
    new Set([dashboardsDir, 'queries', chartsDir, 'themes', 'databases', 'data']),
  )

  return {
    userCwd,
    dashboardsDir,
    chartsDir,
    syncedDirs,
    project,
    region,
    service,
    bucket,
    mode,
    memory,
    mcpToken,
    packageManager: detectPackageManager(userCwd),
  }
}

export async function runGcpCheck(
  flags: GcpDeployFlags = {},
  userCwd: string = process.cwd(),
  runner: CommandRunner = defaultRunner,
): Promise<GcpCheckReport> {
  const report = await inspectGcpEnvironment(userCwd, flags, runner)
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report
  }

  process.stdout.write(`\n${c.bold('open-dashboard deploy gcp — Environment Check')}\n\n`)
  for (const item of report.items) {
    const icon =
      item.status === 'ok' ? c.green('✔') : item.status === 'warn' ? c.yellow('!') : c.red('✖')
    process.stdout.write(`  ${icon} ${c.bold(item.label)}: ${item.detail}\n`)
    if (item.remedy) {
      process.stdout.write(`    ${c.dim(`→ ${item.remedy}`)}\n`)
    }
  }
  process.stdout.write('\n')
  return report
}

function syncFoldersWithGcs(
  direction: 'push' | 'pull',
  opts: Pick<ResolvedGcpDeployOptions, 'userCwd' | 'syncedDirs' | 'bucket' | 'project'>,
  flags: { dryRun?: boolean; delete?: boolean },
  runner: CommandRunner,
): void {
  for (const dir of opts.syncedDirs) {
    const localPath = path.join(opts.userCwd, dir)
    const remoteUri = `gs://${opts.bucket}/${dir}`

    if (direction === 'push' && !existsSync(localPath)) {
      continue
    }
    if (direction === 'pull' && !existsSync(localPath) && !flags.dryRun) {
      mkdirSync(localPath, { recursive: true })
    }

    const src = direction === 'push' ? localPath : remoteUri
    const dst = direction === 'push' ? remoteUri : localPath
    const args = ['storage', 'rsync', src, dst, '--recursive', `--project=${opts.project}`]
    if (flags.delete) args.push('--delete-unmatched-destination-objects')
    if (flags.dryRun) args.push('--dry-run')

    process.stdout.write(
      `  ${c.cyan('↻')} Syncing ${c.bold(dir)} (${direction === 'push' ? 'local → GCS' : 'GCS → local'})...\n`,
    )
    if (flags.dryRun) {
      process.stdout.write(`    ${c.dim(`gcloud ${args.join(' ')}`)}\n`)
      continue
    }

    const res = runner('gcloud', args, { cwd: opts.userCwd })
    if (!res.ok && direction === 'pull' && /not found|matched no objects/i.test(res.stderr)) {
      continue
    }
    if (!res.ok) {
      throw new Error(`Failed syncing ${dir}: ${res.stderr || res.stdout}`)
    }
  }
}

export async function runGcpUp(
  flags: GcpDeployFlags = {},
  userCwd: string = process.cwd(),
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const check = await inspectGcpEnvironment(userCwd, flags, runner)
  const fatal = check.items.find((i) => i.status === 'fail')
  if (fatal && !flags.dryRun) {
    await runGcpCheck(flags, userCwd, runner)
    throw new Error(`${fatal.label}: ${fatal.detail}. ${fatal.remedy ?? ''}`)
  }

  const opts = await resolveGcpDeployOptions(userCwd, flags, runner, !flags.dryRun)

  process.stdout.write(`\n${c.bold('Deploying open-dashboard to Google Cloud Run')}\n`)
  process.stdout.write(`  ${c.dim('Project:')}  ${c.cyan(opts.project)}\n`)
  process.stdout.write(`  ${c.dim('Region:')}   ${c.cyan(opts.region)}\n`)
  process.stdout.write(`  ${c.dim('Service:')}  ${c.cyan(opts.service)}\n`)
  process.stdout.write(`  ${c.dim('Mode:')}     ${c.cyan(opts.mode)}\n`)
  if (opts.mode === 'editable') {
    process.stdout.write(`  ${c.dim('Bucket:')}   ${c.cyan(`gs://${opts.bucket}`)}\n`)
  }
  process.stdout.write('\n')

  const deployArgs = buildGcloudDeployArgs(opts)

  if (flags.dryRun) {
    process.stdout.write(`${c.yellow('[dry-run]')} Generated commands:\n`)
    process.stdout.write(
      `  1. gcloud services enable ${REQUIRED_GCP_APIS.join(' ')} --project=${opts.project}\n`,
    )
    if (opts.mode === 'editable') {
      process.stdout.write(
        `  2. gcloud storage buckets create gs://${opts.bucket} --project=${opts.project} --location=${opts.region}\n`,
      )
      syncFoldersWithGcs('push', opts, { dryRun: true }, runner)
    }
    process.stdout.write(`  3. gcloud ${deployArgs.join(' ')}\n\n`)
    if (opts.mode === 'editable') {
      process.stdout.write(`${c.bold('Antigravity MCP config preview:')}\n`)
      process.stdout.write(
        `${formatAntigravityMcpSnippet(
          opts.service,
          `https://${opts.service}-<hash>.${opts.region}.run.app`,
          opts.mcpToken,
        )}\n`,
      )
    }
    return
  }

  // 1. Enable required GCP APIs
  process.stdout.write(`  ${c.cyan('1/4')} Ensuring required GCP APIs are enabled...\n`)
  const apiRes = runner('gcloud', [
    'services',
    'enable',
    ...REQUIRED_GCP_APIS,
    `--project=${opts.project}`,
  ])
  if (!apiRes.ok) {
    throw new Error(`Failed enabling GCP APIs: ${apiRes.stderr || apiRes.stdout}`)
  }

  // 2. Provision GCS bucket & grant Service Account permissions if editable
  if (opts.mode === 'editable') {
    process.stdout.write(
      `  ${c.cyan('2/4')} Preparing Cloud Storage bucket ${c.bold(`gs://${opts.bucket}`)}...\n`,
    )
    const describeBucket = runner('gcloud', [
      'storage',
      'buckets',
      'describe',
      `gs://${opts.bucket}`,
      `--project=${opts.project}`,
    ])
    if (!describeBucket.ok) {
      const createBucket = runner('gcloud', [
        'storage',
        'buckets',
        'create',
        `gs://${opts.bucket}`,
        `--project=${opts.project}`,
        `--location=${opts.region}`,
        '--uniform-bucket-level-access',
      ])
      if (!createBucket.ok) {
        throw new Error(
          `Failed creating bucket gs://${opts.bucket}: ${createBucket.stderr || createBucket.stdout}`,
        )
      }
    }

    const projNumRes = runner('gcloud', [
      'projects',
      'describe',
      opts.project,
      '--format=value(projectNumber)',
    ])
    const projNum = projNumRes.ok ? projNumRes.stdout.trim() : ''
    if (projNum) {
      const computeSa = `${projNum}-compute@developer.gserviceaccount.com`
      runner('gcloud', [
        'storage',
        'buckets',
        'add-iam-policy-binding',
        `gs://${opts.bucket}`,
        `--member=serviceAccount:${computeSa}`,
        '--role=roles/storage.objectAdmin',
        `--project=${opts.project}`,
      ])
    }

    syncFoldersWithGcs('push', opts, {}, runner)
  }

  // 3. Write temporary Dockerfile, entrypoint, and ignore files for Cloud Build
  process.stdout.write(`  ${c.cyan('3/4')} Building and deploying container to Cloud Run...\n`)
  const dockerfilePath = path.join(userCwd, 'Dockerfile')
  const entrypointPath = path.join(userCwd, '.open-dashboard-entrypoint.sh')
  const dockerignorePath = path.join(userCwd, '.dockerignore')

  const hadDockerfile = existsSync(dockerfilePath)
  const hadEntrypoint = existsSync(entrypointPath)
  const hadDockerignore = existsSync(dockerignorePath)

  try {
    if (!hadDockerfile) {
      writeFileSync(dockerfilePath, generateDockerfile(opts), 'utf8')
    }
    if (!hadEntrypoint) {
      writeFileSync(entrypointPath, generateEntrypointScript(opts), {
        encoding: 'utf8',
        mode: 0o755,
      })
    }
    if (!hadDockerignore) {
      writeFileSync(dockerignorePath, generateDockerignore(), 'utf8')
    }

    const deployRes = runner('gcloud', deployArgs, { cwd: userCwd, inherit: true })
    if (!deployRes.ok) {
      throw new Error('Cloud Run deployment failed.')
    }
  } finally {
    if (!hadDockerfile && existsSync(dockerfilePath)) rmSync(dockerfilePath, { force: true })
    if (!hadEntrypoint && existsSync(entrypointPath)) rmSync(entrypointPath, { force: true })
    if (!hadDockerignore && existsSync(dockerignorePath)) rmSync(dockerignorePath, { force: true })
  }

  // 4. Fetch the deployed Cloud Run URL and save state
  const urlRes = runner('gcloud', [
    'run',
    'services',
    'describe',
    opts.service,
    `--project=${opts.project}`,
    `--region=${opts.region}`,
    '--format=value(status.url)',
  ])
  const serviceUrl =
    urlRes.ok && urlRes.stdout ? urlRes.stdout.trim() : `https://${opts.service}.run.app`

  writeCloudState(userCwd, {
    provider: 'gcp',
    project: opts.project,
    region: opts.region,
    service: opts.service,
    bucket: opts.bucket,
    mode: opts.mode,
    memory: opts.memory,
    mcpToken: opts.mcpToken,
    serviceUrl,
    stopped: false,
    updatedAt: new Date().toISOString(),
  })

  process.stdout.write(`\n  ${c.green('✔')} ${c.bold('Deployment complete!')}\n`)
  process.stdout.write(`  ${c.green('➜')}  ${c.bold('Cloud URL')}: ${c.cyan(serviceUrl)}\n`)
  if (opts.mode === 'editable') {
    process.stdout.write(
      `  ${c.green('➜')}  ${c.bold('MCP URL')}:   ${c.cyan(`${serviceUrl.replace(/\/$/, '')}/mcp`)}\n\n`,
    )
    process.stdout.write(
      `${c.bold('Add this to your Antigravity `mcp_config.json` to edit cloud dashboards directly:')}\n`,
    )
    process.stdout.write(
      `${c.dim(formatAntigravityMcpSnippet(opts.service, serviceUrl, opts.mcpToken))}\n\n`,
    )
  }
}

export async function runGcpStatus(
  flags: GcpDeployFlags = {},
  userCwd: string = process.cwd(),
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const opts = await resolveGcpDeployOptions(userCwd, flags, runner, false)
  const state = readCloudState(userCwd)

  const descRes = runner('gcloud', [
    'run',
    'services',
    'describe',
    opts.service,
    `--project=${opts.project}`,
    `--region=${opts.region}`,
    '--format=value(status.url)',
  ])
  const deployed = descRes.ok && Boolean(descRes.stdout.trim())
  const serviceUrl = deployed ? descRes.stdout.trim() : state.serviceUrl

  const iamRes = deployed
    ? runner('gcloud', [
        'run',
        'services',
        'get-iam-policy',
        opts.service,
        `--project=${opts.project}`,
        `--region=${opts.region}`,
        '--format=json',
      ])
    : { ok: false, status: 1, stdout: '', stderr: '' }
  const publicAccess = iamRes.ok && iamRes.stdout.includes('allUsers')

  const payload = {
    deployed,
    project: opts.project,
    region: opts.region,
    service: opts.service,
    bucket: opts.bucket,
    mode: opts.mode,
    serviceUrl: serviceUrl ?? null,
    publicAccess,
    mcpEndpoint:
      serviceUrl && opts.mode === 'editable' ? `${serviceUrl.replace(/\/$/, '')}/mcp` : null,
  }

  if (flags.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
    return
  }

  process.stdout.write(`\n${c.bold('open-dashboard deploy gcp — Service Status')}\n\n`)
  process.stdout.write(
    `  ${c.dim('Status:')}     ${
      !deployed
        ? c.red('Not deployed')
        : publicAccess
          ? c.green('Active (publicly reachable)')
          : c.yellow('Stopped / Locked (403 to external traffic, scaled to 0)')
    }\n`,
  )
  process.stdout.write(`  ${c.dim('Project:')}    ${opts.project}\n`)
  process.stdout.write(`  ${c.dim('Region:')}     ${opts.region}\n`)
  process.stdout.write(`  ${c.dim('Service:')}    ${opts.service}\n`)
  process.stdout.write(`  ${c.dim('Bucket:')}     gs://${opts.bucket}\n`)
  if (serviceUrl) {
    process.stdout.write(`  ${c.dim('Cloud URL:')}  ${c.cyan(serviceUrl)}\n`)
    if (opts.mode === 'editable') {
      process.stdout.write(
        `\n${c.bold('Antigravity MCP Configuration:')}\n${c.dim(
          formatAntigravityMcpSnippet(opts.service, serviceUrl, opts.mcpToken),
        )}\n`,
      )
    }
  }
  process.stdout.write('\n')
}

export async function runGcpPull(
  flags: GcpDeployFlags = {},
  userCwd: string = process.cwd(),
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const opts = await resolveGcpDeployOptions(userCwd, flags, runner, false)
  process.stdout.write(
    `\n${c.bold(`Pulling latest dashboards & queries from gs://${opts.bucket}...`)}\n`,
  )
  syncFoldersWithGcs(
    'pull',
    opts,
    {
      ...(flags.dryRun !== undefined ? { dryRun: flags.dryRun } : {}),
      ...(flags.delete !== undefined ? { delete: flags.delete } : {}),
    },
    runner,
  )
  process.stdout.write(`  ${c.green('✔')} Local workspace updated from Cloud Storage.\n\n`)
}

export async function runGcpPush(
  flags: GcpDeployFlags = {},
  userCwd: string = process.cwd(),
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const opts = await resolveGcpDeployOptions(userCwd, flags, runner, false)
  process.stdout.write(
    `\n${c.bold(`Pushing local dashboards & queries to gs://${opts.bucket}...`)}\n`,
  )
  syncFoldersWithGcs(
    'push',
    opts,
    {
      ...(flags.dryRun !== undefined ? { dryRun: flags.dryRun } : {}),
      ...(flags.delete !== undefined ? { delete: flags.delete } : {}),
    },
    runner,
  )
  process.stdout.write(`  ${c.green('✔')} Cloud Storage updated from local workspace.\n\n`)
}

export async function runGcpStop(
  flags: GcpDeployFlags = {},
  userCwd: string = process.cwd(),
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const opts = await resolveGcpDeployOptions(userCwd, flags, runner, false)
  if (flags.pull) {
    await runGcpPull(flags, userCwd, runner)
  }
  process.stdout.write(
    `\n${c.bold(`Stopping public access to Cloud Run service "${opts.service}"...`)}\n`,
  )
  const res = runner('gcloud', [
    'run',
    'services',
    'remove-iam-policy-binding',
    opts.service,
    '--member=allUsers',
    '--role=roles/run.invoker',
    `--project=${opts.project}`,
    `--region=${opts.region}`,
    '--quiet',
  ])
  if (!res.ok && !/Policy binding .* not found/i.test(res.stderr)) {
    throw new Error(`Failed stopping service: ${res.stderr || res.stdout}`)
  }
  const prev = readCloudState(userCwd)
  writeCloudState(userCwd, {
    provider: 'gcp',
    project: opts.project,
    region: opts.region,
    service: opts.service,
    bucket: opts.bucket,
    mode: opts.mode,
    memory: opts.memory,
    mcpToken: opts.mcpToken,
    ...(prev.serviceUrl ? { serviceUrl: prev.serviceUrl } : {}),
    stopped: true,
    updatedAt: new Date().toISOString(),
  })
  process.stdout.write(
    `  ${c.green('✔')} Service "${opts.service}" is now locked (403) and scaled to 0 instances.\n`,
  )
  process.stdout.write(
    `  ${c.dim('Run `open-dashboard deploy gcp start` anytime to restore public access.')}\n\n`,
  )
}

export async function runGcpStart(
  flags: GcpDeployFlags = {},
  userCwd: string = process.cwd(),
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const opts = await resolveGcpDeployOptions(userCwd, flags, runner, false)
  process.stdout.write(
    `\n${c.bold(`Restoring public access to Cloud Run service "${opts.service}"...`)}\n`,
  )
  const res = runner('gcloud', [
    'run',
    'services',
    'add-iam-policy-binding',
    opts.service,
    '--member=allUsers',
    '--role=roles/run.invoker',
    `--project=${opts.project}`,
    `--region=${opts.region}`,
    '--quiet',
  ])
  if (!res.ok) {
    throw new Error(`Failed starting service: ${res.stderr || res.stdout}`)
  }
  const prev = readCloudState(userCwd)
  writeCloudState(userCwd, {
    provider: 'gcp',
    project: opts.project,
    region: opts.region,
    service: opts.service,
    bucket: opts.bucket,
    mode: opts.mode,
    memory: opts.memory,
    mcpToken: opts.mcpToken,
    ...(prev.serviceUrl ? { serviceUrl: prev.serviceUrl } : {}),
    stopped: false,
    updatedAt: new Date().toISOString(),
  })
  process.stdout.write(`  ${c.green('✔')} Service "${opts.service}" is live again!\n\n`)
}

export async function runGcpDown(
  flags: GcpDeployFlags = {},
  userCwd: string = process.cwd(),
  runner: CommandRunner = defaultRunner,
): Promise<void> {
  const opts = await resolveGcpDeployOptions(userCwd, flags, runner, false)

  if (!flags.skipPull && opts.mode === 'editable') {
    process.stdout.write(
      `\n  ${c.cyan('1/2')} Backing up latest cloud edits from gs://${opts.bucket} to local workspace...\n`,
    )
    syncFoldersWithGcs(
      'pull',
      opts,
      flags.dryRun !== undefined ? { dryRun: flags.dryRun } : {},
      runner,
    )
  }

  process.stdout.write(
    `  ${c.cyan('2/2')} Deleting Cloud Run service "${opts.service}" in ${opts.region}...\n`,
  )
  const delArgs = [
    'run',
    'services',
    'delete',
    opts.service,
    `--project=${opts.project}`,
    `--region=${opts.region}`,
    '--quiet',
  ]
  if (flags.dryRun) {
    process.stdout.write(`    ${c.dim(`gcloud ${delArgs.join(' ')}`)}\n`)
  } else {
    const delRes = runner('gcloud', delArgs)
    if (!delRes.ok && !/could not be found|not found/i.test(delRes.stderr)) {
      throw new Error(`Failed deleting Cloud Run service: ${delRes.stderr || delRes.stdout}`)
    }
  }

  if (flags.purgeStorage) {
    const bucketArgs = [
      'storage',
      'rm',
      '--recursive',
      `gs://${opts.bucket}`,
      `--project=${opts.project}`,
      '--quiet',
    ]
    process.stdout.write(`  ${c.yellow('!')} Purging bucket gs://${opts.bucket}...\n`)
    if (flags.dryRun) {
      process.stdout.write(`    ${c.dim(`gcloud ${bucketArgs.join(' ')}`)}\n`)
    } else {
      const rmRes = runner('gcloud', bucketArgs)
      if (!rmRes.ok && !/not found/i.test(rmRes.stderr)) {
        throw new Error(`Failed purging bucket: ${rmRes.stderr || rmRes.stdout}`)
      }
    }
  } else {
    process.stdout.write(
      `  ${c.dim(`Cloud Storage bucket gs://${opts.bucket} was preserved (pass --purge-storage to delete it).`)}\n`,
    )
  }

  process.stdout.write(`  ${c.green('✔')} Cloud Run service "${opts.service}" torn down.\n\n`)
}
