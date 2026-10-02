import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadConfig, Workspace } from '../workspace.js'

export interface Fixture {
  root: string
  workspace: Workspace
  write(path: string, content: string): void
  cleanup(): Promise<void>
}

/** A throwaway workspace on disk with one SQLite datasource named `db`. */
export async function makeFixture(files: Record<string, string> = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'odd-test-'))
  const write = (path: string, content: string) => {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  const db = new DatabaseSync(join(root, 'test.db'))
  db.exec(`
    CREATE TABLE sales (id INTEGER PRIMARY KEY, day TEXT NOT NULL, region TEXT NOT NULL, amount REAL NOT NULL);
    INSERT INTO sales (day, region, amount) VALUES
      ('2026-09-01', 'North', 10), ('2026-09-02', 'South', 20), ('2026-09-03', 'North', 30);
  `)
  db.close()
  write(
    'open-dashboard.config.mjs',
    `export default { datasources: { db: { type: 'sqlite', file: 'test.db' } } }\n`,
  )
  for (const [path, content] of Object.entries(files)) write(path, content)
  const workspace = new Workspace(await loadConfig(root))
  return {
    root,
    workspace,
    write,
    cleanup: async () => {
      await workspace.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
