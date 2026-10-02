import type { QueryResult } from '../config.js'

function cell(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e4) / 1e4)
  return String(value).replace(/\s+/g, ' ')
}

/** A plain-text table an agent can read in a terminal transcript. */
export function formatResult(result: QueryResult, limit = 50): string {
  const names = result.columns.map((c) => c.name)
  if (names.length === 0) return '(no columns)\n'
  const rows = result.rows
    .slice(0, limit)
    .map((row) => names.map((name) => cell(row[name]).slice(0, 40)))
  const widths = names.map((name, i) =>
    Math.max(name.length, ...rows.map((r) => (r[i] ?? '').length)),
  )
  const line = (values: string[]) => values.map((v, i) => v.padEnd(widths[i] ?? 0)).join(' │ ')
  const out = [
    line(names),
    widths.map((w) => '─'.repeat(w)).join('─┼─'),
    ...rows.map(line),
    '',
    `${result.rows.length} row${result.rows.length === 1 ? '' : 's'}${result.rows.length > limit ? ` (showing ${limit})` : ''}${result.truncated ? ', truncated' : ''} · ${result.elapsedMs.toFixed(1)} ms · types: ${result.columns.map((c) => `${c.name}:${c.type}`).join(', ')}`,
  ]
  return `${out.join('\n')}\n`
}
