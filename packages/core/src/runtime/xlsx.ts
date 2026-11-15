/**
 * One result as an Excel workbook, with no library: a .xlsx is a zip of XML
 * parts, written here with stored (uncompressed) entries, which every reader
 * accepts. The header row is bold, frozen and filterable; numbers stay numbers
 * and booleans booleans, so the sheet sums and sorts like one typed by hand.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A zip of stored entries. */
export function zipStored(files: { name: string; data: string }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = enc.encode(f.data)
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, data)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, data.length, true)
    entry.setUint32(24, data.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    central.push(new Uint8Array(entry.buffer), name)
    offset += 30 + name.length + data.length
  }
  const size = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, size, true)
  end.setUint32(16, offset, true)
  const all = [...parts, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of all) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** XML 1.0 has no place for control characters other than tab, line feed and carriage return. */
const printable = (s: string) =>
  [...s]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 || ch === '\t' || ch === '\n' || ch === '\r')
    .join('')

const xml = (s: string) =>
  printable(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function column(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Excel's sheet names: 31 characters, none of : \ / ? * [ ]. */
export function sheetName(title: string): string {
  return (
    title
      .replace(/[:\\/?*[\]]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet1'
  )
}

type Rows = { columns: { name: string }[]; rows: Record<string, unknown>[] }

export function resultToXlsx(result: Rows, title: string): Uint8Array {
  return resultsToXlsx([{ title, result }])
}

/** Sheet names Excel accepts, made distinct (case-insensitively) with " (2)", " (3)"…. */
export function distinctSheetNames(titles: string[]): string[] {
  const used = new Set<string>()
  return titles.map((title) => {
    const base = sheetName(title)
    let name = base
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`
    }
    used.add(name.toLowerCase())
    return name
  })
}

function worksheet(result: Rows): string {
  const names = result.columns.map((c) => c.name)
  const cell = (ref: string, v: unknown, header = false): string => {
    const s = header ? ' s="1"' : ''
    if (v === null || v === undefined || v === '') return ''
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`
    if (typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`
  }
  const rows = [
    `<row r="1">${names.map((n, i) => cell(`${column(i)}1`, n, true)).join('')}</row>`,
    ...result.rows.map(
      (row, r) =>
        `<row r="${r + 2}">${names.map((n, i) => cell(`${column(i)}${r + 2}`, row[n])).join('')}</row>`,
    ),
  ]
  // Width in characters: the longest of the header and the first rows, CJK counted double.
  const width = (v: unknown) =>
    [...String(v ?? '')].reduce((w, ch) => w + (/[ᄀ-ᇿ⺀-꓏가-힯豈-﫿＀-￯]/.test(ch) ? 2 : 1), 0)
  const cols = names
    .map((n, i) => {
      const w = Math.min(
        60,
        Math.max(8, width(n), ...result.rows.slice(0, 200).map((row) => width(row[n]))) + 2,
      )
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
    })
    .join('')
  const last = `${column(Math.max(0, names.length - 1))}${result.rows.length + 1}`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`
}

/**
 * One workbook, a sheet per result in order — a panel's download is one sheet,
 * a dashboard's has one per panel with rows. Each sheet's header is bold,
 * frozen and filterable.
 */
export function resultsToXlsx(sheets: { title: string; result: Rows }[]): Uint8Array {
  if (sheets.length === 0) throw new Error('nothing to export: no panel on this page has rows')
  const names = distinctSheetNames(sheets.map((s) => s.title))
  const range = (r: Rows) =>
    `$A$1:$${column(Math.max(0, r.columns.length - 1))}$${r.rows.length + 1}`
  const sheetParts = names
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')
  return zipStored([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetParts}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${names.map((name, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(name.replace(/'/g, "''"))}'!${range((sheets[i] as { result: Rows }).result)}</definedName>`).join('')}</definedNames></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: worksheet(s.result),
    })),
  ])
}
