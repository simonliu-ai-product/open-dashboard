import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'
import type { Row, SqliteSource, TableInfo } from '../config.js'
import { normalizeRows } from './normalize.js'
import { bindParams, compileParams } from './params.js'
import { type Datasource, DatasourceError } from './types.js'

type SqliteModule = typeof import('node:sqlite')

async function loadSqlite(): Promise<SqliteModule> {
  try {
    return await import('node:sqlite')
  } catch {
    throw new DatasourceError(
      `SQLite needs Node 22.13 or newer (this is ${process.version}) — node:sqlite is built in from there`,
      500,
    )
  }
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/**
 * Opened read-only *and* with query_only set: the first stops writes to the
 * file, the second stops writes to anything ATTACHed later, which the
 * read-only flag on its own does not cover.
 */
export async function openSqlite(
  name: string,
  config: SqliteSource,
  root: string,
): Promise<Datasource> {
  const file = resolve(root, config.file)
  if (!existsSync(file)) {
    throw new DatasourceError(`datasource "${name}": no SQLite file at ${file}`, 500)
  }
  const { DatabaseSync } = await loadSqlite()
  const open = (): { db: DatabaseSyncType; inode: number } => {
    const db = new DatabaseSync(file, { readOnly: true })
    db.exec('PRAGMA query_only = ON')
    return { db, inode: statSync(file).ino }
  }
  let current = open()

  /**
   * A regenerated file (a seed script, a fresh export) replaces the inode, and
   * an open handle keeps reading the deleted one forever. Reopen when the path
   * points somewhere new.
   */
  const handle = (): DatabaseSyncType => {
    let inode: number | undefined
    try {
      inode = statSync(file).ino
    } catch {
      throw new DatasourceError(`datasource "${name}": no SQLite file at ${file}`, 500)
    }
    if (inode !== current.inode) {
      if (current.db.isOpen) current.db.close()
      current = open()
    }
    return current.db
  }

  return {
    name,
    type: 'sqlite',
    async query(sql, params, options) {
      const started = performance.now()
      const compiled = compileParams(sql, 'question')
      const values = bindParams(compiled.names, params)
      const statement = handle().prepare(compiled.text)
      const rows: Row[] = []
      let truncated = false
      for (const row of statement.iterate(...(values as never[]))) {
        if (rows.length >= options.maxRows) {
          truncated = true
          break
        }
        rows.push(row as Row)
      }
      const names =
        rows.length > 0
          ? Object.keys(rows[0] as Row)
          : ((statement as { columns?: () => { name: string }[] }).columns?.().map((c) => c.name) ??
            [])
      const normalized = normalizeRows(rows, names)
      return { ...normalized, truncated, elapsedMs: performance.now() - started }
    },
    async schema() {
      const db = handle()
      const objects = db
        .prepare(
          "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as { name: string; type: 'table' | 'view' }[]
      const tables: TableInfo[] = objects.map((object) => {
        const columns = (
          db.prepare(`PRAGMA table_info(${quoteIdent(object.name)})`).all() as {
            name: string
            type: string
            notnull: number
            pk: number
          }[]
        ).map((c) => ({
          name: c.name,
          type: c.type || 'ANY',
          nullable: c.notnull === 0 && c.pk === 0,
          primaryKey: c.pk > 0,
        }))
        const foreignKeys = (
          db.prepare(`PRAGMA foreign_key_list(${quoteIdent(object.name)})`).all() as {
            from: string
            table: string
            to: string | null
          }[]
        ).map((fk) => ({ column: fk.from, table: fk.table, references: fk.to ?? 'rowid' }))
        const info: TableInfo = { name: object.name, kind: object.type, columns, foreignKeys }
        if (object.type === 'table') {
          const count = db
            .prepare(`SELECT count(*) AS n FROM ${quoteIdent(object.name)}`)
            .get() as {
            n: number
          }
          info.rowCount = Number(count.n)
        }
        return info
      })
      return { source: name, type: 'sqlite', tables }
    },
    async close() {
      if (current.db.isOpen) current.db.close()
    },
  }
}
