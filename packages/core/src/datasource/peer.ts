import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatasourceError } from './types.js'

/**
 * Drivers are optional peers the *workspace* installs, and under pnpm's strict
 * layout core cannot see a package it does not depend on. So resolve from the
 * workspace first, and only then from here.
 */
export async function importPeer<T>(specifier: string, root: string, install: string): Promise<T> {
  const anchors = [join(root, 'package.json'), import.meta.url]
  for (const anchor of anchors) {
    if (!anchor.startsWith('file:') && !existsSync(anchor)) continue
    try {
      const resolved = createRequire(anchor).resolve(specifier)
      const loaded = (await import(pathToFileURL(resolved).href)) as { default?: T } & T
      return (loaded.default ?? loaded) as T
    } catch {
      // try the next anchor
    }
  }
  throw new DatasourceError(
    `this datasource needs the "${install}" package — run: pnpm add ${install}`,
    500,
  )
}
