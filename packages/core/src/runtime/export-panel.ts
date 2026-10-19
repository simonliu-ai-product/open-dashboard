import { jpegToPdf } from './pdf.js'

/**
 * A panel as a picture — vector SVG, and PNG drawn from it.
 *
 * The SVG is built from what the browser laid out, not by wrapping the panel
 * in `<foreignObject>`: that only renders in a browser, and a chart dropped into
 * Keynote, Illustrator or Preview would come out blank. So boxes become rects,
 * text nodes become `<text>` at the position they were laid out at, and each
 * chart `<svg>` is copied with its computed styles written onto every element —
 * the page stylesheet, the `--odd-*` variables and `color-mix()` do not travel.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'
const PNG_SCALE = 2

const SKIP = [
  '.odd-panel-actions',
  '.odd-grip',
  '.odd-handle',
  '.odd-size-badge',
  '.odd-panel-progress',
  '.odd-tooltip',
  '.odd-crosshair',
  '.odd-hover-band',
  '[data-export-skip]',
].join(',')

const SVG_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant-numeric',
  'text-anchor',
  'dominant-baseline',
  'shape-rendering',
  'paint-order',
] as const

const COLOR_PROPS = new Set(['fill', 'stroke'])

/** 'html' is the whole dashboard as one interactive file, built by the server; 'csv', 'json' and 'md' export a panel's rows. */
export type ImageFormat = 'png' | 'svg' | 'pdf' | 'html' | 'csv' | 'json' | 'md'
export type PictureFormat = 'png' | 'svg' | 'pdf'

async function encode(
  drawn: { svg: string; width: number; height: number },
  format: PictureFormat,
  background: string | undefined,
  title: string,
): Promise<Blob> {
  const { svg, width, height } = drawn
  if (format === 'svg') return new Blob([svg], { type: 'image/svg+xml' })
  if (format === 'png') return rasterise(svg, width, height, 'image/png')
  // JPEG has no transparency: what would be clear is painted with the page behind it.
  const jpeg = await rasterise(svg, width, height, 'image/jpeg', background ?? '#ffffff')
  const pdf = jpegToPdf(
    new Uint8Array(await jpeg.arrayBuffer()),
    { width: Math.round(width * PNG_SCALE), height: Math.round(height * PNG_SCALE) },
    { width, height },
    title,
  )
  return new Blob([pdf as BlobPart], { type: 'application/pdf' })
}

export async function downloadPanel(
  panel: HTMLElement,
  format: PictureFormat,
  name: string,
  title = name,
): Promise<void> {
  const blob = await encode(panelToSvg(panel), format, backgroundOf(panel), title)
  downloadBlob(blob, `${name}.${format}`)
}

/** The whole dashboard — title, filters and every panel — as one image, on the page's background. */
export async function downloadDashboard(
  page: HTMLElement,
  format: PictureFormat,
  name: string,
  title = name,
): Promise<void> {
  const background = backgroundOf(page)
  const blob = await encode(elementToSvg(page, background), format, background, title)
  downloadBlob(blob, `${name}.${format}`)
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function resultToCsv(result: {
  columns: { name: string }[]
  rows: Record<string, unknown>[]
}): string {
  const names = result.columns.map((c) => c.name)
  const header = names.map(csvCell).join(',')
  const body = result.rows.map((row) => names.map((n) => csvCell(row[n])).join(','))
  return [header, ...body].join('\r\n')
}

export function resultToMarkdown(result: {
  columns: { name: string }[]
  rows: Record<string, unknown>[]
}): string {
  const names = result.columns.map((c) => c.name)
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  }
  const head = `| ${names.map(esc).join(' | ')} |`
  const sep = `| ${names.map(() => '---').join(' | ')} |`
  const body = result.rows.map((row) => `| ${names.map((n) => esc(row[n])).join(' | ')} |`)
  return [head, sep, ...body].join('\n')
}

export function downloadData(
  result: { columns: { name: string }[]; rows: Record<string, unknown>[] },
  format: 'csv' | 'json' | 'md',
  name: string,
): void {
  if (format === 'csv') {
    const blob = new Blob([resultToCsv(result)], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, `${name}.csv`)
    return
  }
  if (format === 'md') {
    const blob = new Blob([resultToMarkdown(result)], { type: 'text/markdown;charset=utf-8' })
    downloadBlob(blob, `${name}.md`)
    return
  }
  const blob = new Blob([JSON.stringify(result.rows, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  downloadBlob(blob, `${name}.json`)
}

/** The first painted background at or above an element: what the page shows behind it. */
function backgroundOf(element: HTMLElement): string | undefined {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const fill = paint(getComputedStyle(node).backgroundColor)
    if (fill) return fill
  }
  return undefined
}

export function exportName(dashboard: string, title: string): string {
  const slug = title
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
  return [dashboard, slug].filter(Boolean).join('-') || 'panel'
}

export function panelToSvg(panel: HTMLElement): { svg: string; width: number; height: number } {
  return elementToSvg(panel)
}

function elementToSvg(
  panel: HTMLElement,
  background?: string,
): { svg: string; width: number; height: number } {
  const origin = panel.getBoundingClientRect()
  const width = Math.ceil(origin.width)
  const height = Math.ceil(origin.height)
  const out = new Builder(origin.left, origin.top)

  const style = getComputedStyle(panel)
  if (background) out.open(`<rect width="${width}" height="${height}" fill="${background}"/>`)
  out.box(style, origin)
  out.open(`<g clip-path="url(#${out.clip(0, 0, width, height, radius(style))})">`)
  for (const child of Array.from(panel.childNodes)) out.node(child)
  out.close('</g>')
  out.ring(style, width, height)

  const svg =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs>${out.defs.join('')}</defs>${out.parts.join('')}</svg>`
  return { svg, width, height }
}

class Builder {
  parts: string[] = []
  defs: string[] = []
  private ids = 0

  constructor(
    private x0: number,
    private y0: number,
  ) {}

  open(markup: string) {
    this.parts.push(markup)
  }

  close(markup: string) {
    this.parts.push(markup)
  }

  clip(x: number, y: number, w: number, h: number, r = 0): string {
    const id = `c${this.ids++}`
    this.defs.push(
      `<clipPath id="${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}"/></clipPath>`,
    )
    return id
  }

  node(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement
      if (parent) this.text(node as Text, getComputedStyle(parent))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as Element
    if (element.matches(SKIP)) return
    if (element instanceof SVGSVGElement) {
      this.svg(element)
      return
    }
    if (!(element instanceof HTMLElement)) return
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
      return
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0 && element.childNodes.length === 0) return
    if (element instanceof HTMLSelectElement) {
      // A closed <select> draws its choice itself; its options have no boxes to copy.
      this.box(style, rect)
      this.label(element.selectedOptions[0]?.textContent ?? '', style, rect)
      this.chevron(rect)
      return
    }
    if (element instanceof HTMLInputElement) {
      if (element.type === 'checkbox' || element.type === 'radio') {
        this.checkbox(element, style, rect)
        return
      }
      this.box(style, rect)
      this.inputValue(element, style, rect)
      return
    }

    const opacity = Number(style.opacity)
    const clipped = style.overflowX !== 'visible' || style.overflowY !== 'visible'
    let wrapped = 0
    if (opacity < 1) {
      this.open(`<g opacity="${n(opacity)}">`)
      wrapped++
    }
    this.box(style, rect)
    if (clipped) {
      const id = this.clip(
        rect.left - this.x0,
        rect.top - this.y0,
        rect.width,
        rect.height,
        radius(style),
      )
      this.open(`<g clip-path="url(#${id})">`)
      wrapped++
    }
    for (const child of Array.from(element.childNodes)) this.node(child)
    if (element.classList.contains('odd-multiselect-trigger')) {
      this.chevron(rect)
    }
    for (let i = 0; i < wrapped; i++) this.close('</g>')
  }

  box(style: CSSStyleDeclaration, rect: DOMRect) {
    const x = rect.left - this.x0
    const y = rect.top - this.y0
    const r = radius(style)
    const fill = paint(style.backgroundColor)
    if (fill) {
      this.parts.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(rect.width)}" height="${n(rect.height)}" rx="${n(r)}" fill="${fill}"/>`,
      )
    }
    const gradient = this.gradient(style.backgroundImage)
    if (gradient) {
      this.parts.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(rect.width)}" height="${n(rect.height)}" rx="${n(r)}" fill="url(#${gradient})"/>`,
      )
    }
    this.borders(style, x, y, rect.width, rect.height)
    const ring = ringColor(style.boxShadow)
    if (ring && rect.width > 1 && rect.height > 1) {
      this.parts.push(
        `<rect x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${n(rect.width - 1)}" height="${n(rect.height - 1)}" rx="${n(r)}" fill="none" stroke="${ring}"/>`,
      )
    }
  }

  ring(style: CSSStyleDeclaration, width: number, height: number) {
    const color = ringColor(style.boxShadow)
    if (!color) return
    this.parts.push(
      `<rect x="0.5" y="0.5" width="${n(width - 1)}" height="${n(height - 1)}" rx="${n(radius(style))}" fill="none" stroke="${color}"/>`,
    )
  }

  chevron(rect: DOMRect) {
    const cx = rect.right - this.x0 - 15
    const cy = rect.top - this.y0 + rect.height / 2 - 2
    this.parts.push(
      `<path d="M${n(cx)} ${n(cy)}l4 4 4-4" stroke="#898781" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
    )
  }

  checkbox(element: HTMLInputElement, style: CSSStyleDeclaration, rect: DOMRect) {
    if (rect.width <= 0 || rect.height <= 0) return
    const x = rect.left - this.x0
    const y = rect.top - this.y0
    const w = rect.width
    const h = rect.height
    const accent = paint(style.accentColor) ?? '#2563eb'
    if (element.checked) {
      this.parts.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="3" fill="${accent}"/>`,
      )
      const x1 = x + w * 0.22
      const y1 = y + h * 0.52
      const x2 = x + w * 0.44
      const y2 = y + h * 0.74
      const x3 = x + w * 0.78
      const y3 = y + h * 0.28
      this.parts.push(
        `<path d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}L${n(x3)} ${n(y3)}" stroke="#ffffff" stroke-width="1.75" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
    } else {
      this.parts.push(
        `<rect x="${n(x + 0.5)}" y="${n(y + 0.5)}" width="${n(w - 1)}" height="${n(h - 1)}" rx="3" fill="#ffffff" stroke="#898781"/>`,
      )
    }
  }

  inputValue(element: HTMLInputElement, style: CSSStyleDeclaration, rect: DOMRect) {
    const hasValue = element.value.trim() !== ''
    const raw = hasValue ? element.value : element.placeholder
    const value = (raw ?? '').replace(/\s+/g, ' ').trim()
    if (!value) return
    const padLeft = Number.parseFloat(style.paddingLeft) || 8
    const padRight = Number.parseFloat(style.paddingRight) || 8
    const x = rect.left - this.x0 + padLeft
    const y = rect.top - this.y0 + rect.height / 2
    const fill = hasValue ? (paint(style.color) ?? '#000') : '#898781'
    const clipId = this.clip(
      rect.left - this.x0 + padLeft,
      rect.top - this.y0,
      Math.max(0, rect.width - padLeft - padRight),
      rect.height,
    )
    this.parts.push(
      `<g clip-path="url(#${clipId})"><text x="${n(x)}" y="${n(y)}" dominant-baseline="central" fill="${fill}" font-family="${attr(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}">${escapeXml(value)}</text></g>`,
    )
  }

  private borders(style: CSSStyleDeclaration, x: number, y: number, w: number, h: number) {
    const sides: [string, number, number, number, number][] = [
      ['Top', x, y, x + w, y],
      ['Bottom', x, y + h, x + w, y + h],
      ['Left', x, y, x, y + h],
      ['Right', x + w, y, x + w, y + h],
    ]
    for (const [side, x1, y1, x2, y2] of sides) {
      const width = Number.parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`))
      const kind = style.getPropertyValue(`border-${side.toLowerCase()}-style`)
      const color = paint(style.getPropertyValue(`border-${side.toLowerCase()}-color`))
      if (!width || kind === 'none' || !color) continue
      const inset = width / 2
      const dx = side === 'Left' ? inset : side === 'Right' ? -inset : 0
      const dy = side === 'Top' ? inset : side === 'Bottom' ? -inset : 0
      this.parts.push(
        `<line x1="${n(x1 + dx)}" y1="${n(y1 + dy)}" x2="${n(x2 + dx)}" y2="${n(y2 + dy)}" stroke="${color}" stroke-width="${n(width)}"${kind === 'dashed' ? ' stroke-dasharray="4 3"' : ''}/>`,
      )
    }
  }

  private gradient(image: string): string | undefined {
    if (!image.startsWith('linear-gradient')) return undefined
    const colors = [...image.matchAll(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/gi)]
      .map((m) => paint(m[1] ?? ''))
      .filter((c): c is string => Boolean(c))
    if (colors.length < 2) return undefined
    const vertical = /to (top|bottom)|180deg|0deg/.test(image)
    const id = `g${this.ids++}`
    const stops = colors
      .map(
        (color, i) =>
          `<stop offset="${n((i / (colors.length - 1)) * 100)}%" stop-color="${color}"/>`,
      )
      .join('')
    this.defs.push(
      `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops}</linearGradient>`,
    )
    return id
  }

  text(node: Text, style: CSSStyleDeclaration) {
    const content = node.textContent ?? ''
    if (!content.trim()) return
    if (style.visibility === 'hidden') return
    const lines = layoutLines(node)
    const fill = paint(style.color) ?? '#000'
    const transform = style.textTransform
    const font =
      `font-family="${attr(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}"` +
      (style.fontStyle !== 'normal' ? ` font-style="${style.fontStyle}"` : '') +
      (style.fontVariantNumeric !== 'normal'
        ? ` font-variant-numeric="${style.fontVariantNumeric}"`
        : '')
    for (const line of lines) {
      let value = line.text.replace(/\s+/g, ' ').trim()
      if (!value) continue
      if (transform === 'uppercase') value = value.toUpperCase()
      if (transform === 'lowercase') value = value.toLowerCase()
      const x = line.left - this.x0
      const y = line.top - this.y0 + line.height / 2
      this.parts.push(
        `<text x="${n(x)}" y="${n(y)}" dominant-baseline="central" fill="${fill}" ${font}>${escapeXml(value)}</text>`,
      )
    }
  }

  label(content: string, style: CSSStyleDeclaration, rect: DOMRect) {
    const value = content.replace(/\s+/g, ' ').trim()
    if (!value) return
    const padLeft = Number.parseFloat(style.paddingLeft) || 10
    const padRight = Number.parseFloat(style.paddingRight) || 28
    const x = rect.left - this.x0 + padLeft
    const y = rect.top - this.y0 + rect.height / 2
    const clipId = this.clip(
      rect.left - this.x0 + padLeft,
      rect.top - this.y0,
      Math.max(0, rect.width - padLeft - padRight),
      rect.height,
    )
    this.parts.push(
      `<g clip-path="url(#${clipId})"><text x="${n(x)}" y="${n(y)}" dominant-baseline="central" fill="${paint(style.color) ?? '#000'}" font-family="${attr(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}">${escapeXml(value)}</text></g>`,
    )
  }

  svg(source: SVGSVGElement) {
    const rect = source.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const clone = source.cloneNode(true) as SVGSVGElement
    inlineSvg(source, clone)
    clone.setAttribute('x', n(rect.left - this.x0))
    clone.setAttribute('y', n(rect.top - this.y0))
    clone.setAttribute('width', n(rect.width))
    clone.setAttribute('height', n(rect.height))
    clone.setAttribute('overflow', 'visible')
    clone.removeAttribute('class')
    clone.removeAttribute('style')
    this.parts.push(new XMLSerializer().serializeToString(clone).replace(/ xmlns="[^"]*"/, ''))
  }
}

interface Line {
  text: string
  left: number
  top: number
  height: number
}

const TOKEN_RE =
  /\s+|[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]|[^\s\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]+/gu

/** A text node as the lines the browser broke it into, each where it was drawn. */
function layoutLines(node: Text): Line[] {
  const range = document.createRange()
  range.selectNodeContents(node)
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0)
  const first = rects[0]
  if (!first) return []

  const parent = node.parentElement
  let clipBox: DOMRect | undefined
  let lineClamp = 0
  let ellipsis = false
  for (let el: HTMLElement | null = parent; el; el = el.parentElement) {
    const st = getComputedStyle(el)
    if (st.overflowX === 'hidden' || st.overflowY === 'hidden') {
      clipBox = el.getBoundingClientRect()
      const clamp = Number.parseInt(st.webkitLineClamp || '0', 10)
      if (clamp > 0) lineClamp = clamp
      if (st.textOverflow === 'ellipsis' && st.whiteSpace === 'nowrap') ellipsis = true
      break
    }
  }

  if (rects.length === 1 && !ellipsis) {
    return [
      { text: node.textContent ?? '', left: first.left, top: first.top, height: first.height },
    ]
  }

  const lines: Line[] = []
  const content = node.textContent ?? ''
  let truncatedByEllipsis = false

  const pushPiece = (piece: string, box: DOMRect) => {
    if (ellipsis && clipBox && box.right > clipBox.right - 6) {
      truncatedByEllipsis = true
      return false
    }
    const last = lines.at(-1)
    if (last && Math.abs(last.top - box.top) < box.height / 2) {
      last.text += piece
    } else {
      lines.push({ text: piece, left: box.left, top: box.top, height: box.height })
    }
    return true
  }

  for (const match of content.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0
    const token = match[0]
    range.setStart(node, start)
    range.setEnd(node, start + token.length)
    const tokenRects = Array.from(range.getClientRects()).filter((r) => r.width > 0)
    if (tokenRects.length === 0) continue
    if (tokenRects.length === 1 && !(ellipsis && clipBox && tokenRects[0]!.right > clipBox.right)) {
      if (!pushPiece(token, tokenRects[0]!)) break
    } else {
      let stopped = false
      let offset = start
      for (const ch of token) {
        range.setStart(node, offset)
        range.setEnd(node, offset + ch.length)
        offset += ch.length
        const chBox = Array.from(range.getClientRects()).find((r) => r.width > 0)
        if (!chBox) continue
        if (!pushPiece(ch, chBox)) {
          stopped = true
          break
        }
      }
      if (stopped) break
    }
  }

  if (truncatedByEllipsis && lines.length > 0) {
    const last = lines.at(-1)!
    last.text = `${last.text.trimEnd()}…`
  }

  if (lineClamp > 0 && lines.length > lineClamp) {
    const clamped = lines.slice(0, lineClamp)
    const last = clamped.at(-1)
    if (last) last.text = `${last.text.replace(/[、，,.\s]+$/, '')}…`
    return clamped
  }

  if (clipBox) {
    return lines.filter((line) => line.top + line.height * 0.6 <= clipBox.bottom + 2)
  }

  return lines
}

function inlineSvg(source: Element, clone: Element) {
  const sources = [source, ...Array.from(source.querySelectorAll('*'))]
  const clones = [clone, ...Array.from(clone.querySelectorAll('*'))]
  const drop: Element[] = []
  sources.forEach((element, i) => {
    const target = clones[i]
    if (!target) return
    if (element.matches(SKIP)) {
      drop.push(target)
      return
    }
    const style = getComputedStyle(element)
    if (style.display === 'none') {
      drop.push(target)
      return
    }
    const declarations: string[] = []
    for (const prop of SVG_PROPS) {
      let value = style.getPropertyValue(prop)
      if (!value) continue
      if (COLOR_PROPS.has(prop)) value = paint(value) ?? 'none'
      declarations.push(`${prop}:${value}`)
    }
    for (const name of ['fill', 'stroke', 'color']) {
      if (target.getAttribute(name)?.includes('var(')) target.removeAttribute(name)
    }
    target.removeAttribute('class')
    target.setAttribute('style', declarations.join(';'))
  })
  for (const element of drop) element.remove()
}

let probe: CanvasRenderingContext2D | null | undefined

/**
 * Any CSS colour as one an SVG viewer reads: `rgb()`/`#hex`. Computed styles
 * can still hand back `color(srgb …)` for a `color-mix()`, which only browsers
 * understand; a canvas normalises it.
 */
function paint(value: string): string | undefined {
  if (!value || value === 'none' || value === 'transparent') return undefined
  if (/^rgba\([^)]*,\s*0\)$/.test(value)) return undefined
  if (value.startsWith('url(')) return undefined
  if (probe === undefined) probe = document.createElement('canvas').getContext('2d')
  if (!probe) return value
  probe.fillStyle = '#000000'
  probe.fillStyle = value
  const result = String(probe.fillStyle)
  if (/^rgba\([^)]*,\s*0\)$/.test(result)) return undefined
  return result
}

/** The first `0 0 0 1px <color>` ring of a box-shadow — the panel's hairline border. */
function ringColor(shadow: string): string | undefined {
  if (!shadow || shadow === 'none') return undefined
  const match =
    /(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]+)\s+0px\s+0px\s+0px\s+1px(?:\s+inset)?/i.exec(shadow)
  return match?.[1] ? paint(match[1]) : undefined
}

function radius(style: CSSStyleDeclaration): number {
  return Number.parseFloat(style.borderTopLeftRadius) || 0
}

function n(value: number): string {
  return String(Math.round(value * 100) / 100)
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attr(value: string): string {
  return escapeXml(value).replace(/"/g, "'")
}

async function rasterise(
  svg: string,
  width: number,
  height: number,
  type: 'image/png' | 'image/jpeg',
  background?: string,
): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('The panel could not be drawn as an image.'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * PNG_SCALE)
    canvas.height = Math.round(height * PNG_SCALE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser would not give a 2D canvas.')
    if (background) {
      ctx.fillStyle = background
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.setTransform(PNG_SCALE, 0, 0, PNG_SCALE, 0, 0)
    ctx.drawImage(image, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The canvas produced no image.'))),
        type,
        0.92,
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Chrome reads the blob after the click returns, and later still when it asks where to save or an extension
  // handles the download; revoked by then, the file arrives named by the blob's UUID with no extension.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
