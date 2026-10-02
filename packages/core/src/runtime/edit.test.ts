import { foldEdits, stageEdit } from './edit.js'

const panels = [
  {
    title: 'A',
    component: 'BarChart',
    props: { x: 'region', y: 'revenue', horizontal: true, span: 6 },
    locked: [],
    siblings: ['A', 'B'],
    inRow: true,
  },
  {
    title: 'B',
    component: 'Table',
    props: { span: 6 },
    locked: [],
    siblings: ['A', 'B'],
    inRow: true,
  },
]

describe('foldEdits', () => {
  it('replays props, type changes and order into per-panel overrides', () => {
    const folded = foldEdits(panels, [
      { kind: 'props', title: 'A', set: { span: 8 } },
      { kind: 'component', title: 'A', component: 'PieChart' },
      { kind: 'order', titles: ['B', 'A'] },
    ])
    expect(folded.A).toEqual({
      component: 'PieChart',
      changes: { span: 8, label: 'region', value: 'revenue', x: null, y: null, horizontal: null },
      order: 1,
    })
    expect(folded.B).toEqual({ changes: {}, order: 0 })
  })
})

describe('stageEdit', () => {
  it('merges consecutive prop edits to the same panel into one undo step', () => {
    let edits = stageEdit([], { kind: 'props', title: 'A', set: { span: 7 } })
    edits = stageEdit(edits, { kind: 'props', title: 'A', set: { span: 8, height: 300 } })
    edits = stageEdit(edits, { kind: 'props', title: 'B', set: { span: 4 } })
    expect(edits).toEqual([
      { kind: 'props', title: 'A', set: { span: 8, height: 300 } },
      { kind: 'props', title: 'B', set: { span: 4 } },
    ])
  })
})
