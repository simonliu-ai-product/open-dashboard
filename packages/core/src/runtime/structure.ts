/**
 * Moving panels between rows and rows within their parent — one definition,
 * used by the page to preview and by the server to decide what to write, so
 * the two can never disagree about where a panel ends up.
 *
 * Rows are numbered in document order across the whole dashboard (Sections
 * included). Indices in an edit refer to the rows as they stand when that edit
 * is applied, after every earlier edit.
 */
export interface RowShape {
  /** The row's number in the source as last saved — stable through staged edits. */
  id: number
  /** Rows can only be reordered among rows with the same parent. */
  parent: string
  titles: string[]
}

export type StructureEdit =
  | { kind: 'move'; title: string; row: number; index: number }
  | { kind: 'moveRow'; from: number; to: number }

export class StructureError extends Error {}

/** The rows after one edit. A row left without panels is removed. */
export function applyStructure(rows: RowShape[], edit: StructureEdit): RowShape[] {
  const next = rows.map((row) => ({ ...row, titles: [...row.titles] }))
  if (edit.kind === 'move') {
    const from = next.findIndex((row) => row.titles.includes(edit.title))
    if (from === -1) throw new StructureError(`"${edit.title}" is not in a row`)
    const target = next[edit.row]
    if (!target) throw new StructureError(`there is no row ${edit.row + 1}`)
    const source = next[from] as RowShape
    source.titles.splice(source.titles.indexOf(edit.title), 1)
    target.titles.splice(Math.max(0, Math.min(edit.index, target.titles.length)), 0, edit.title)
    return next.filter((row) => row.titles.length > 0)
  }
  const moving = next[edit.from]
  const target = next[edit.to]
  if (!moving || !target) throw new StructureError('there is no such row')
  if (moving.parent !== target.parent) {
    throw new StructureError('a row can only move among the rows of the same section')
  }
  // The parent's rows keep their slots in the document; only which row sits
  // in which slot changes.
  const slots = next.map((row, i) => (row.parent === moving.parent ? i : -1)).filter((i) => i >= 0)
  const order = slots.map((i) => next[i] as RowShape)
  const fromPos = slots.indexOf(edit.from)
  const toPos = slots.indexOf(edit.to)
  const [row] = order.splice(fromPos, 1)
  order.splice(toPos, 0, row as RowShape)
  slots.forEach((slot, k) => {
    next[slot] = order[k] as RowShape
  })
  return next
}

export function sameStructure(a: RowShape[], b: RowShape[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => row.id === b[i]?.id && row.titles.join('\n') === b[i]?.titles.join('\n'))
  )
}
