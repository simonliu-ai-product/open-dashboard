import { describe, expect, it } from 'vitest'
import { resultToXlsx, sheetName } from './xlsx.js'

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('panel results as .xlsx', () => {
  it('is a zip whose sheet keeps numbers as numbers and text as text', () => {
    const bytes = resultToXlsx(
      {
        columns: [{ name: '業務' }, { name: 'revenue' }, { name: 'paid' }, { name: 'note' }],
        rows: [
          { 業務: '阿美', revenue: 192000, paid: true, note: null },
          { 業務: '<小林>', revenue: 134400, paid: false, note: { a: 1 } },
        ],
      },
      'By rep',
    )
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    const all = text(bytes)
    expect(all).toContain(
      '<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">業務</t></is></c>',
    )
    expect(all).toContain('<c r="B2"><v>192000</v></c>')
    expect(all).toContain('<c r="C3" t="b"><v>0</v></c>')
    expect(all).toContain('&lt;小林&gt;')
    expect(all).toContain('{&quot;a&quot;:1}')
    expect(all).toContain('<autoFilter ref="A1:D3"/>')
    expect(all).toContain('state="frozen"')
  })

  it('makes a legal sheet name', () => {
    expect(sheetName('Revenue: 2026/Q1 [draft]')).toBe('Revenue  2026 Q1  draft')
    expect(sheetName('')).toBe('Sheet1')
    expect(sheetName('x'.repeat(40))).toHaveLength(31)
  })
})

describe('a workbook with a sheet per panel', () => {
  it('writes each result to its own sheet, names made distinct and valid', async () => {
    const { resultsToXlsx, distinctSheetNames } = await import('./xlsx.js')
    expect(distinctSheetNames(['Sales', 'sales', 'a/b', 'x'.repeat(40), 'x'.repeat(40)])).toEqual([
      'Sales',
      'sales (2)',
      'a b',
      'x'.repeat(31),
      `${'x'.repeat(27)} (2)`,
    ])
    const one = { columns: [{ name: 'n' }], rows: [{ n: 1 }] }
    const bytes = resultsToXlsx([
      { title: 'A', result: one },
      { title: 'B', result: { columns: [{ name: 'k' }, { name: 'v' }], rows: [{ k: 'x', v: 2 }] } },
    ])
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).toContain('xl/worksheets/sheet2.xml')
    expect(text).toContain('<sheet name="B" sheetId="2" r:id="rId2"/>')
    expect(text).toContain('Target="styles.xml"')
    expect(text).toMatch(/Id="rId3"[^>]*styles/)
    expect(() => resultsToXlsx([])).toThrow(/no panel/)
  })
})
