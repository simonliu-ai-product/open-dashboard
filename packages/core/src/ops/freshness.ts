import type { Freshness } from '../config.js'
import type { ResolvedConfig } from '../workspace.js'

const FILE_TYPES = new Set(['json', 'csv', 'sqlite', 'duckdb'])

/** How current a source is wherever the workspace is built — see `Freshness`. */
export function sourceFreshness(config: ResolvedConfig, name: string): Freshness {
  const source = config.datasources[name]
  if (!source) return 'static'
  if (source.freshness) return source.freshness
  if (Object.values(config.collectors).some((c) => c.source === name)) return 'collected'
  if (source.type === 'duckdb' && !source.file) return 'live'
  return FILE_TYPES.has(source.type) ? 'static' : 'live'
}

export type SourcesByFreshness = Record<Freshness, string[]>

/**
 * The sources, grouped by how current they are. A rebuild brings new data only
 * through `live` ones: with none, refreshing a build elsewhere changes nothing.
 */
export function freshnessOf(config: ResolvedConfig, sources: string[]): SourcesByFreshness {
  const grouped: SourcesByFreshness = { live: [], collected: [], static: [] }
  for (const name of [...new Set(sources)].sort()) grouped[sourceFreshness(config, name)].push(name)
  return grouped
}
