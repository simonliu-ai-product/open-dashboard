export interface Intersection {
  sets: string[]
  value: number
}

/**
 * Rows naming a combination of sets ('Beans,Grinders') and a count, into
 * intersections (largest first, duplicate combinations merged regardless of
 * order) and per-set totals. Sets are ordered by total, largest first.
 */
export function upsetData(
  rows: Record<string, unknown>[],
  keys: { sets: string; value: string },
  top = 15,
): { sets: { name: string; total: number }[]; intersections: Intersection[]; hidden: number } {
  const merged = new Map<string, Intersection>()
  for (const row of rows) {
    const raw = row[keys.sets]
    const value = Number(row[keys.value])
    if (raw === null || raw === undefined || !Number.isFinite(value) || value <= 0) continue
    const sets = [
      ...new Set(
        String(raw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].sort()
    if (sets.length === 0) continue
    const key = sets.join('\u0000')
    const found = merged.get(key)
    if (found) found.value += value
    else merged.set(key, { sets, value })
  }
  const all = [...merged.values()].sort(
    (a, b) => b.value - a.value || a.sets.length - b.sets.length,
  )
  const totals = new Map<string, number>()
  for (const i of all) for (const s of i.sets) totals.set(s, (totals.get(s) ?? 0) + i.value)
  const sets = [...totals]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
  const shown = all.slice(0, Math.max(1, top))
  return { sets, intersections: shown, hidden: all.length - shown.length }
}
