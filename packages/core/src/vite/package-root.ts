import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Anchored on the package root rather than on hops relative to this file: the
 * bundler decides which chunk this code lands in, and a relative path breaks
 * silently the next time that changes.
 */
export function packageRoot(): string {
  let dir = here
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'app'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(here, '..')
}

export function sourceEntry(...parts: string[]): string {
  const path = join(packageRoot(), 'src', ...parts)
  if (!existsSync(path)) {
    throw new Error(
      `cannot locate ${parts.join('/')} in the open-dashboard package (${packageRoot()})`,
    )
  }
  return path
}
