import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * API responses on disk, shared by every process in the workspace: what the
 * dev server fetched, `check` can reuse instead of spending the API's quota
 * again. Files are named by a hash of the request, so a token in a URL never
 * reaches the disk; the bodies are the user's data, like query results.
 */
export interface ResponseStore {
  read(key: string, maxAgeMs: number): unknown
  write(key: string, body: unknown): void
}

export function responseDir(root: string): string {
  return join(root, 'node_modules', '.open-dashboard', 'responses')
}

export function responseStore(root: string): ResponseStore {
  const dir = responseDir(root)
  const path = (key: string) => join(dir, `${createHash('sha256').update(key).digest('hex')}.json`)
  return {
    read(key, maxAgeMs) {
      try {
        const saved = JSON.parse(readFileSync(path(key), 'utf8')) as { at: number; body: unknown }
        return Date.now() - saved.at < maxAgeMs ? saved.body : undefined
      } catch {
        return undefined
      }
    },
    write(key, body) {
      try {
        mkdirSync(dir, { recursive: true })
        const file = path(key)
        const temp = `${file}.${process.pid}.tmp`
        writeFileSync(temp, JSON.stringify({ at: Date.now(), body }))
        renameSync(temp, file)
      } catch {
        // A read-only node_modules only costs the reuse.
      }
    },
  }
}
