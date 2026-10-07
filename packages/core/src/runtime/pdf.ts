/**
 * A one-page PDF holding one JPEG, sized to the image: the smallest PDF that
 * is a correct one, written by hand so core needs no PDF library. The page is
 * in points at 96 CSS pixels to the inch, scaled down only when it would pass
 * the 14,400 pt page limit.
 */
const MAX_PAGE = 14_400

/** A PDF text string: UTF-16BE with a byte-order mark, so any title survives. */
function textString(text: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < text.length; i += 1)
    hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  return `<${hex}>`
}

export function jpegToPdf(
  jpeg: Uint8Array,
  pixels: { width: number; height: number },
  css: { width: number; height: number },
  title = '',
): Uint8Array {
  const scale = Math.min(0.75, MAX_PAGE / Math.max(css.width, css.height))
  const w = +(css.width * scale).toFixed(2)
  const h = +(css.height * scale).toFixed(2)
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    parts.push(bytes)
    length += bytes.length
  }
  const object = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
    for (const piece of Array.isArray(body) ? body : [body]) push(piece)
    push('\nendobj\n')
  }
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`

  // A binary comment on line two tells transfer tools the file is binary.
  push('%PDF-1.4\n%âãÏÓ\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
  )
  object(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  object(5, [
    `<< /Type /XObject /Subtype /Image /Width ${pixels.width} /Height ${pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ])
  object(6, `<< /Title ${textString(title)} /Producer (open-dashboard) >>`)

  const xref = length
  push(`xref\n0 7\n0000000000 65535 f \n`)
  for (let n = 1; n <= 6; n += 1) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
