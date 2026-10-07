import { describe, expect, it } from 'vitest'
import { jpegToPdf } from './pdf.js'

const decoder = new TextDecoder('latin1')

describe('jpegToPdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
  const pdf = jpegToPdf(
    jpeg,
    { width: 200, height: 100 },
    { width: 100, height: 50 },
    '銷售 Overview',
  )
  const text = decoder.decode(pdf)

  it('sizes the page in points from CSS pixels', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true)
    expect(text).toContain('/MediaBox [0 0 75 37.5]')
    expect(text).toContain('/Width 200 /Height 100')
    expect(text).toContain(`/Length ${jpeg.length}`)
  })

  it('points every xref entry at its object', () => {
    const start = Number(/startxref\n(\d+)/.exec(text)?.[1])
    expect(text.slice(start, start + 4)).toBe('xref')
    const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    )
    expect(offsets).toHaveLength(6)
    offsets.forEach((offset, i) => {
      expect(text.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`)
    })
  })

  it('keeps the image bytes as they are', () => {
    const at = text.indexOf('stream\n', text.indexOf('/DCTDecode')) + 'stream\n'.length
    expect([...pdf.slice(at, at + jpeg.length)]).toEqual([...jpeg])
  })

  it('writes any title as UTF-16', () => {
    expect(text).toContain('/Title <FEFF92B7552E0020004F')
  })

  it('stays within the page size limit', () => {
    const tall = decoder.decode(
      jpegToPdf(jpeg, { width: 2, height: 2 }, { width: 1000, height: 40_000 }),
    )
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(tall)
    expect(Number(box?.[2])).toBeLessThanOrEqual(14_400)
  })
})
