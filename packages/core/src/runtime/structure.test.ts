import { applyStructure, type RowShape } from './structure.js'

const rows: RowShape[] = [
  { id: 0, parent: 'root', titles: ['A', 'B'] },
  { id: 1, parent: 'root', titles: ['C'] },
  { id: 2, parent: 'sec', titles: ['D'] },
  { id: 3, parent: 'root', titles: ['E', 'F'] },
]

describe('applyStructure', () => {
  it('moves a panel into another row at a position', () => {
    expect(
      applyStructure(rows, { kind: 'move', title: 'E', row: 0, index: 1 }).map((r) => r.titles),
    ).toEqual([['A', 'E', 'B'], ['C'], ['D'], ['F']])
  })

  it('reorders within a row, and drops a row it empties', () => {
    expect(applyStructure(rows, { kind: 'move', title: 'A', row: 0, index: 1 })[0]?.titles).toEqual(
      ['B', 'A'],
    )
    const after = applyStructure(rows, { kind: 'move', title: 'C', row: 3, index: 0 })
    expect(after.map((r) => r.id)).toEqual([0, 2, 3])
    expect(after[2]?.titles).toEqual(['C', 'E', 'F'])
  })

  it('reorders rows among their parent, keeping other parents in place', () => {
    const after = applyStructure(rows, { kind: 'moveRow', from: 3, to: 0 })
    expect(after.map((r) => r.id)).toEqual([3, 0, 2, 1])
  })

  it('refuses to move a row out of its section', () => {
    expect(() => applyStructure(rows, { kind: 'moveRow', from: 2, to: 0 })).toThrow(/same section/)
  })
})
