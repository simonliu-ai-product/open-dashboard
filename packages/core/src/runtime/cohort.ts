export interface CohortRow {
  cohort: string
  size: number
  /** Values by period index; undefined where the period has not happened or has no row. */
  values: (number | undefined)[]
}

/**
 * Long rows (cohort, period, value) into a triangle: one row per cohort in
 * first-seen order, periods 0…max. Size is the given size column, else period 0.
 */
export function cohortMatrix(
  rows: Record<string, unknown>[],
  keys: { cohort: string; period: string; value: string; size?: string },
): { rows: CohortRow[]; periods: number } {
  const byCohort = new Map<string, { size?: number; values: Map<number, number> }>()
  let periods = 0
  for (const row of rows) {
    const cohort = String(row[keys.cohort] ?? '—')
    const period = Number(row[keys.period])
    const value = Number(row[keys.value])
    if (!Number.isInteger(period) || period < 0 || !Number.isFinite(value)) continue
    let entry = byCohort.get(cohort)
    if (!entry) {
      entry = { values: new Map() }
      byCohort.set(cohort, entry)
    }
    entry.values.set(period, (entry.values.get(period) ?? 0) + value)
    if (keys.size !== undefined) {
      const size = Number(row[keys.size])
      if (Number.isFinite(size)) entry.size = size
    }
    periods = Math.max(periods, period + 1)
  }
  return {
    periods,
    rows: [...byCohort].map(([cohort, entry]) => ({
      cohort,
      size: entry.size ?? entry.values.get(0) ?? 0,
      values: Array.from({ length: periods }, (_, p) => entry.values.get(p)),
    })),
  }
}
