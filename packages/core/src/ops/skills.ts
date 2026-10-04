import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../vite/package-root.js'

/** Where agents read skills: Claude Code, and every other agent. */
export const SKILL_DIRS = ['.claude/skills', '.agents/skills']

function shipped(): { dir: string; names: string[] } {
  const dir = join(packageRoot(), 'skills')
  const names = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
        .map((entry) => entry.name)
        .sort()
    : []
  return { dir, names }
}

/**
 * The framework's skills that a workspace holds in a different version than
 * the installed package — `init` copied them once, and an upgrade does not.
 */
export function staleSkills(root: string): string[] {
  const { dir, names } = shipped()
  return names.filter((name) =>
    SKILL_DIRS.some((target) => {
      const file = join(root, target, name, 'SKILL.md')
      return (
        existsSync(file) &&
        readFileSync(file, 'utf8') !== readFileSync(join(dir, name, 'SKILL.md'), 'utf8')
      )
    }),
  )
}

/**
 * Replace the workspace's copies of the framework's skills with the installed
 * package's. Only those: a skill the user wrote, under any other name, stays.
 */
export function syncSkills(root: string): string[] {
  const { dir, names } = shipped()
  for (const target of SKILL_DIRS) {
    for (const name of names) {
      const destination = join(root, target, name)
      rmSync(destination, { recursive: true, force: true })
      cpSync(join(dir, name), destination, { recursive: true })
    }
  }
  return names
}
