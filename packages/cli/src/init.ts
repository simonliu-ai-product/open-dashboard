import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectPackageManager, installCommand, runCommand } from './package-manager.js'
import { writeSampleDatabase } from './sample.js'

const here = dirname(fileURLToPath(import.meta.url))

export interface InitOptions {
  directory: string
  cwd?: string
  version?: string
  /** Generate data/sample.db and the getting-started dashboard over it. Default true. */
  sample?: boolean
}

export interface InitResult {
  root: string
  files: string[]
  next: string[]
}

function templateDir(): string {
  for (const candidate of [join(here, '..', 'template'), join(here, '..', '..', 'template')]) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error('scaffolder template is missing from the installed package')
}

/**
 * Staged into the template at build time, because `npx … init` installs the
 * scaffolder alone. The other lookups are for running out of the monorepo.
 */
function skillsDir(root: string): string | undefined {
  const staged = join(root, 'skills')
  if (existsSync(join(staged, 'create-dashboard', 'SKILL.md'))) return staged
  try {
    const core = createRequire(import.meta.url).resolve(
      '@open-database-dashboard/core/package.json',
    )
    const candidate = join(dirname(core), 'skills')
    if (existsSync(candidate)) return candidate
  } catch {
    // fall through to the monorepo layout
  }
  for (const candidate of [
    join(here, '..', '..', 'core', 'skills'),
    join(here, '..', '..', '..', 'core', 'skills'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * The packages version together, so a scaffolder at 0.1.0 pins a framework at
 * ^0.1.0 — the pair it was tested against.
 */
function frameworkVersion(): string {
  for (const candidate of [
    join(here, '..', 'package.json'),
    join(here, '..', '..', 'package.json'),
  ]) {
    try {
      const own = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version?: string }
      if (own.name === '@open-database-dashboard/cli' && own.version) return `^${own.version}`
    } catch {
      // keep looking
    }
  }
  return 'latest'
}

export async function init(options: InitOptions): Promise<InitResult> {
  const root = resolve(options.cwd ?? process.cwd(), options.directory)
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`${root} already exists and is not empty`)
  }

  mkdirSync(root, { recursive: true })
  cpSync(templateDir(), root, { recursive: true })

  const name = options.directory.split('/').filter(Boolean).pop() ?? 'my-dashboards'
  const packageJson = join(root, 'package.json')
  writeFileSync(
    packageJson,
    readFileSync(packageJson, 'utf8')
      .replaceAll('__NAME__', name)
      .replaceAll('__VERSION__', options.version ?? frameworkVersion()),
  )

  // npm strips dotfiles from a published package, so the template ships them
  // renamed and they are restored here.
  for (const [shipped, real] of [
    ['gitignore', '.gitignore'],
    ['env.example', '.env.example'],
  ] as const) {
    if (existsSync(join(root, shipped))) renameSync(join(root, shipped), join(root, real))
  }

  const skills = skillsDir(root)
  if (skills) {
    // Both conventions: Claude Code reads .claude/skills, other agents .agents/skills.
    for (const target of ['.claude/skills', '.agents/skills']) {
      const destination = join(root, target)
      mkdirSync(destination, { recursive: true })
      cpSync(skills, destination, { recursive: true })
    }
    rmSync(join(root, 'skills'), { recursive: true, force: true })
  }

  if (options.sample === false) {
    rmSync(join(root, 'dashboards', 'getting-started'), { recursive: true, force: true })
    writeFileSync(
      join(root, 'open-dashboard.config.ts'),
      readFileSync(join(root, 'open-dashboard.config.ts'), 'utf8').replace(
        /\n\s*sample: \{[^}]*\},?/,
        '',
      ),
    )
  } else {
    await writeSampleDatabase(join(root, 'data', 'sample.db'))
  }

  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else files.push(path.slice(root.length + 1))
    }
  }
  walk(root)

  const manager = detectPackageManager()
  return {
    root,
    files: files.sort(),
    next: [`cd ${options.directory}`, installCommand(manager), runCommand(manager, 'dev')],
  }
}
