import { chmodSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'

/**
 * Writes `file` through a temporary file beside it and a rename, so whoever
 * reads it meanwhile — Vite's watcher reloading a dashboard, an agent reading
 * current.json — sees the old content or the new, never half of it. An
 * existing file keeps its permissions.
 */
export function writeFileAtomic(file: string, content: string): void {
  const temp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  let mode: number | undefined
  try {
    mode = statSync(file).mode & 0o7777
  } catch {
    // A new file takes the default mode.
  }
  try {
    writeFileSync(temp, content)
    if (mode !== undefined) chmodSync(temp, mode)
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}
