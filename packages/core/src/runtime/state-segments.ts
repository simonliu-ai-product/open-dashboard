export interface StateRow {
  lane: string
  at: number
  state: string
  end?: number
}

export interface Segment {
  lane: string
  state: string
  start: number
  end: number
}

/**
 * Lanes of consecutive states. Without an explicit end, a state lasts until
 * the lane's next row; the last one lasts until `until` (the latest time seen,
 * unless given). Adjacent rows in the same state merge into one segment.
 */
export function stateSegments(
  rows: StateRow[],
  until?: number,
): { lanes: string[]; segments: Segment[]; start: number; end: number } {
  const lanes: string[] = []
  const byLane = new Map<string, StateRow[]>()
  for (const row of rows) {
    if (!Number.isFinite(row.at)) continue
    if (!byLane.has(row.lane)) {
      byLane.set(row.lane, [])
      lanes.push(row.lane)
    }
    byLane.get(row.lane)?.push(row)
  }
  const latest = Math.max(
    -Infinity,
    ...rows
      .filter((r) => Number.isFinite(r.at))
      .map((r) => (Number.isFinite(r.end) ? (r.end as number) : r.at)),
  )
  const stop = until ?? latest
  const segments: Segment[] = []
  for (const lane of lanes) {
    const list = (byLane.get(lane) ?? []).sort((a, b) => a.at - b.at)
    list.forEach((row, i) => {
      const next = list[i + 1]
      const end = Number.isFinite(row.end) ? (row.end as number) : next ? next.at : stop
      if (end <= row.at) return
      const last = segments[segments.length - 1]
      if (last && last.lane === lane && last.state === row.state && last.end === row.at)
        last.end = end
      else segments.push({ lane, state: row.state, start: row.at, end })
    })
  }
  const first = Math.min(Infinity, ...segments.map((s) => s.start))
  return {
    lanes,
    segments,
    start: Number.isFinite(first) ? first : 0,
    end: Number.isFinite(stop) ? stop : 0,
  }
}

/** "3 h 20 min", "45 s", "2 d 4 h" — the two largest units that matter. */
export function humanDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d) return h ? `${d} d ${h} h` : `${d} d`
  if (h) return m ? `${h} h ${m} min` : `${h} h`
  if (m) return sec && m < 10 ? `${m} min ${sec} s` : `${m} min`
  return `${sec} s`
}

/** Totals per state across all lanes, for the legend and tooltip shares. */
export function stateTotals(segments: Segment[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of segments) out.set(s.state, (out.get(s.state) ?? 0) + (s.end - s.start))
  return out
}
