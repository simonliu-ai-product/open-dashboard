import { parseBlocks, splitDatabaseDoc } from './markdown.js'

const DOC = `# shop

A fictional store. Times are **local**.

## Notes

- Revenue counts \`paid\` only.

## Tables

### orders
One row per order.

- \`status\` — \`paid\`, \`refunded\`, \`cancelled\`.
- \`ordered_at\`: local time, no zone.
- Kept forever.

### analytics.Events
- \`ts\` epoch ms
`

describe('splitDatabaseDoc', () => {
  it('splits the overview, the other sections and the table notes', () => {
    const parts = splitDatabaseDoc(DOC)
    expect(parts.title).toBe('shop')
    expect(parts.overview).toEqual([
      { kind: 'paragraph', text: 'A fictional store. Times are **local**.' },
    ])
    expect(parts.sections.map((s) => s.heading)).toEqual(['Notes'])
    const orders = parts.tables.get('orders')
    expect(orders?.about).toEqual([
      { kind: 'paragraph', text: 'One row per order.' },
      { kind: 'list', ordered: false, items: ['Kept forever.'] },
    ])
    expect(Object.fromEntries(orders?.columns ?? [])).toEqual({
      status: '`paid`, `refunded`, `cancelled`.',
      ordered_at: 'local time, no zone.',
    })
    expect(parts.tables.get('analytics.events')?.columns.get('ts')).toBe('epoch ms')
  })

  it('accepts a translated Tables heading', () => {
    const parts = splitDatabaseDoc('## 資料表\n\n### orders\n- `id` — key\n')
    expect(parts.tables.get('orders')?.columns.get('id')).toBe('key')
    expect(parts.sections).toEqual([])
  })
})

describe('parseBlocks', () => {
  it('reads headings, lists with continuation lines, code and quotes', () => {
    expect(
      parseBlocks('## A\n\n1. one\n   more\n2. two\n\n```sql\nSELECT 1\n```\n\n> careful\n'),
    ).toEqual([
      { kind: 'heading', level: 2, text: 'A' },
      { kind: 'list', ordered: true, items: ['one more', 'two'] },
      { kind: 'code', text: 'SELECT 1' },
      { kind: 'quote', text: 'careful' },
    ])
  })
})
