import type { ParamValue } from '../config.js'

/**
 * Set by a page built with `open-dashboard build`: the path the site is served
 * under, and when its results were taken. Absent on the dev server.
 */
export interface Snapshot {
  base: string
  builtAt: string
  /** A one-file export: always this page, opening at these filters, with nothing else to link to. */
  route?: string
  search?: string
  single?: boolean
}

const store = globalThis as typeof globalThis & { __ODD_SNAPSHOT__?: Snapshot }

export function snapshot(): Snapshot | undefined {
  return store.__ODD_SNAPSHOT__
}

/** "Now" for relative time ranges: a snapshot keeps the day it was taken. */
export function referenceNow(): Date {
  const taken = snapshot()?.builtAt
  return taken ? new Date(taken) : new Date()
}

function basePath(): string {
  return (snapshot()?.base ?? '/').replace(/\/$/, '')
}

/** An in-app path (`/d/sales`) as an address under the site's base. */
export function withBase(path: string): string {
  return basePath() + path
}

/** The in-app path of an address under the site's base. */
export function stripBase(pathname: string): string {
  const base = basePath()
  if (!base || !pathname.startsWith(base)) return pathname
  return pathname.slice(base.length) || '/'
}

/**
 * A stored result is found by the parameters its query reads, and nothing
 * else — the same rule as the dev server's cache, so one stored run serves
 * every filter combination that does not touch the query.
 */
export function snapshotKey(params: Record<string, ParamValue>, reads: Iterable<string>): string {
  return JSON.stringify([...new Set(reads)].sort().map((name) => [name, params[name] ?? null]))
}
