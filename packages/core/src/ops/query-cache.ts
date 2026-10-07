import type { ParamValue } from '../config.js'

/** '30s', '5m', '1h', '1d', '250ms'; 'off' or '0' for no caching. */
export function parseDuration(text: string): number | undefined {
  const value = text.trim().toLowerCase()
  if (value === 'off' || value === 'false' || value === '0') return 0
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/.exec(value)
  if (!match) return undefined
  const n = Number(match[1])
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as 'ms' | 's' | 'm' | 'h' | 'd'
  ]
  return Math.round(n * unit)
}

/**
 * Only the parameters a query reads are part of its key, so a filter the
 * query ignores does not split its cache.
 */
export function cacheKey(
  dashboard: string,
  query: string,
  params: Record<string, ParamValue>,
  reads: Iterable<string>,
): string {
  const used = [...new Set(reads)].sort().map((name) => [name, params[name] ?? null])
  return `${dashboard}\u0000${query}\u0000${JSON.stringify(used)}`
}

interface Entry<T> {
  value: Promise<T>
  storedAt: number
  expires: number
  dashboard: string
}

/**
 * Results kept for a while after they ran, shared by everyone viewing the
 * dashboard. An entry is stored as its pending promise, so identical requests
 * that arrive while the first is still running wait for it instead of running
 * the query again.
 */
export class QueryCache<T> {
  private entries = new Map<string, Entry<T>>()

  constructor(private readonly limit = 200) {}

  get(key: string, now = Date.now()): { value: Promise<T>; storedAt: number } | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= now) {
      this.entries.delete(key)
      return undefined
    }
    // Map order is insertion order: re-inserting marks it recently used.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return { value: entry.value, storedAt: entry.storedAt }
  }

  set(key: string, dashboard: string, value: Promise<T>, ttlMs: number, now = Date.now()): void {
    this.entries.delete(key)
    this.entries.set(key, { value, storedAt: now, expires: now + ttlMs, dashboard })
    // A failed run is not kept: the next request tries again.
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key)
    })
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  /** Drop one dashboard's results (its .sql changed), or everything. */
  clear(dashboard?: string): void {
    if (dashboard === undefined) {
      this.entries.clear()
      return
    }
    for (const [key, entry] of this.entries) {
      if (entry.dashboard === dashboard) this.entries.delete(key)
    }
  }

  get size(): number {
    return this.entries.size
  }
}
