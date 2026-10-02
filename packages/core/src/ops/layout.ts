import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import {
  convertProps,
  isPanelType,
  type LayoutEdit,
  PANEL_NAMES,
  type PanelType,
  type PropValue,
} from '../runtime/convert.js'
import { applyStructure, type RowShape, StructureError } from '../runtime/structure.js'
import type { ResolvedConfig } from '../workspace.js'
import { analyzeDashboard, attributes, elementName, literal, parseSource, walk } from './analyze.js'
import { dashboardFile } from './dashboards.js'
import { OpsError } from './errors.js'

type Node = Parameters<typeof walk>[0]

export const EDITABLE_PANELS = PANEL_NAMES

export type { LayoutEdit }

export interface PanelLayout {
  title: string
  component: string
  /** Props written as literals — the values the editor starts from. */
  props: Record<string, unknown>
  /** Props written as expressions, which the editor must not overwrite. */
  locked: string[]
  /** Titles of the panels sharing this panel's parent, in source order. */
  siblings: string[]
  /** Reorderable only inside a <Row>; a bare panel sits among rows. */
  inRow: boolean
}

export interface DashboardLayout {
  hash: string
  file: string
  panels: PanelLayout[]
  /** Titles used by more than one panel: those panels cannot be edited. */
  duplicates: string[]
  /** Every <Row> in document order, with the panels it holds. */
  rows: RowShape[]
  /** Names of the dashboard's <Select> filters — the targets a click can drill into. */
  filters: string[]
}

const NAMED_FORMATS = new Set([
  'number',
  'integer',
  'decimal',
  'compact',
  'currency',
  'currencyCompact',
  'percent',
  'date',
  'month',
  'text',
])

/** What the page may set, and what each value must look like. */
const SETTABLE: Record<string, (value: PropValue) => boolean> = {
  span: (v) => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 12),
  height: (v) =>
    v === null || (Number.isInteger(v) && (v as number) >= 60 && (v as number) <= 2000),
  x: (v) => v === null || typeof v === 'string',
  y: (v) =>
    v === null ||
    typeof v === 'string' ||
    (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string')),
  series: (v) => v === null || typeof v === 'string',
  label: (v) => v === null || typeof v === 'string',
  value: (v) => v === null || typeof v === 'string',
  column: (v) => v === null || typeof v === 'string',
  format: (v) => v === null || (typeof v === 'string' && NAMED_FORMATS.has(v)),
  stacked: (v) => v === null || typeof v === 'boolean',
  horizontal: (v) => v === null || typeof v === 'boolean',
  area: (v) => v === null || typeof v === 'boolean',
  drill: (v) => v === null || typeof v === 'string',
  size: (v) => v === null || typeof v === 'string',
  group: (v) => v === null || typeof v === 'string',
  from: (v) => v === null || typeof v === 'string',
  to: (v) => v === null || typeof v === 'string',
  zero: (v) => v === null || typeof v === 'boolean',
  invert: (v) => v === null || typeof v === 'boolean',
  ascending: (v) => v === null || typeof v === 'boolean',
  top: (v) => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 50),
  type: (v) => v === null || typeof v === 'string',
  kind: (v) => v === null || v === 'line' || v === 'area' || v === 'bar',
  independent: (v) => v === null || typeof v === 'boolean',
  now: (v) => v === null || typeof v === 'boolean',
  convention: (v) => v === null || v === 'east' || v === 'west',
  bands: (v) => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5),
  scale: (v) => v === null || v === 'sequential' || v === 'diverging',
  agg: (v) => v === null || ['sum', 'count', 'avg', 'min', 'max'].includes(v as string),
  totals: (v) => v === null || typeof v === 'boolean',
  heat: (v) => v === null || typeof v === 'boolean',
  mode: (v) => v === null || v === 'percent' || v === 'count',
  at: (v) => v === null || (typeof v === 'number' && v > 0 && v < 1),
  rows: (v) =>
    v === null || typeof v === 'string' || (Array.isArray(v) && v.length >= 1 && v.length <= 2),
  ...Object.fromEntries(
    [
      'low',
      'high',
      'low2',
      'high2',
      'center',
      'upper',
      'lower',
      'start',
      'end',
      'open',
      'close',
      'region',
      'lat',
      'lng',
      'state',
      'bin',
      'count',
      'source',
      'target',
      'cohort',
      'period',
      'sets',
    ].map((key) => [key, (v: PropValue) => v === null || typeof v === 'string']),
  ),
  max: (v) => v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
  target: (v) =>
    v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)),
}

export function hashSource(code: string): string {
  return createHash('sha256').update(code).digest('hex').slice(0, 16)
}

interface Site {
  node: Node
  parent: Node | undefined
  title: string
  component: string
}

function strictParse(code: string): Node {
  try {
    return parseSource(code, true)
  } catch (error) {
    throw new OpsError(
      `the dashboard has a syntax error, so it cannot be edited from the page: ${(error as Error).message}`,
      409,
    )
  }
}

function sites(ast: Node): Site[] {
  const found: Site[] = []
  walk(ast, (node, parent) => {
    if (node.type !== 'JSXElement') return
    const component = elementName(node)
    if (!component || !EDITABLE_PANELS.has(component)) return
    const title = literal(attributes(node).get('title'))
    if (typeof title === 'string') found.push({ node, parent, title, component })
  })
  return found
}

function find(ast: Node, title: string): Site {
  const matches = sites(ast).filter((site) => site.title === title)
  if (matches.length === 0) throw new OpsError(`no panel titled "${title}"`, 404)
  if (matches.length > 1)
    throw new OpsError(
      `more than one panel is titled "${title}" — give them distinct titles to edit them here`,
      409,
    )
  return matches[0] as Site
}

function attrNodes(node: Node): Node[] {
  return ((node.openingElement as Node).attributes as Node[]) ?? []
}

function attrName(attr: Node): string | undefined {
  return attr.type === 'JSXAttribute' ? ((attr.name as Node).name as string) : undefined
}

function siblingPanels(parent: Node | undefined): Node[] {
  return ((parent?.children as Node[]) ?? []).filter(
    (child) => child.type === 'JSXElement' && EDITABLE_PANELS.has(elementName(child) ?? ''),
  )
}

interface RowSite {
  node: Node
  parent: Node | undefined
  panels: Node[]
}

function rowSites(ast: Node): RowSite[] {
  const found: RowSite[] = []
  walk(ast, (node, parent) => {
    if (node.type === 'JSXElement' && elementName(node) === 'Row') {
      found.push({ node, parent, panels: siblingPanels(node) })
    }
  })
  return found
}

function shapes(ast: Node): RowShape[] {
  return rowSites(ast).map((site, id) => ({
    id,
    parent: `p${site.parent?.start ?? 0}`,
    titles: site.panels
      .map((panel) => literal(attributes(panel).get('title')))
      .filter((title): title is string => typeof title === 'string'),
  }))
}

export function describeLayout(code: string): Omit<DashboardLayout, 'hash' | 'file' | 'filters'> {
  const ast = strictParse(code)
  const all = sites(ast)
  const counts = new Map<string, number>()
  for (const site of all) counts.set(site.title, (counts.get(site.title) ?? 0) + 1)
  const panels = all.map((site): PanelLayout => {
    const props: Record<string, unknown> = {}
    const locked: string[] = []
    for (const attr of attrNodes(site.node)) {
      const name = attrName(attr)
      if (!name) continue
      const value = attr.value as Node | null
      if (value === null) {
        props[name] = true
        continue
      }
      const read = literal(value)
      if (read === undefined || (Array.isArray(read) && read.includes(undefined))) locked.push(name)
      else props[name] = read
    }
    return {
      title: site.title,
      component: site.component,
      props,
      locked,
      siblings: siblingPanels(site.parent)
        .map((node) => literal(attributes(node).get('title')))
        .filter((title): title is string => typeof title === 'string'),
      inRow: site.parent?.type === 'JSXElement' && elementName(site.parent) === 'Row',
    }
  })
  return {
    panels,
    duplicates: [...counts].filter(([, n]) => n > 1).map(([title]) => title),
    rows: shapes(ast),
  }
}

function quote(text: string): string {
  return `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

export function attributeText(name: string, value: Exclude<PropValue, null>): string {
  if (value === true) return name
  if (value === false) return `${name}={false}`
  if (typeof value === 'number') return `${name}={${value}}`
  if (Array.isArray(value)) return `${name}={[${value.map(quote).join(', ')}]}`
  return /["{}<>\n]/.test(value) ? `${name}={${quote(value)}}` : `${name}="${value}"`
}

interface Splice {
  start: number
  end: number
  text: string
}

function splice(code: string, edits: Splice[]): string {
  let out = code
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

function lineIndent(code: string, offset: number): string {
  const lineStart = code.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*/.exec(code.slice(lineStart))?.[0] ?? ''
}

function setProps(
  code: string,
  title: string,
  set: Record<string, PropValue>,
  checked: boolean,
): string {
  const ast = strictParse(code)
  const site = find(ast, title)
  const opening = site.node.openingElement as Node
  const attrs = attrNodes(site.node)
  const edits: Splice[] = []
  const inserts: string[] = []

  for (const [name, value] of Object.entries(set)) {
    if (checked) {
      const valid = SETTABLE[name]
      if (!valid) throw new OpsError(`"${name}" cannot be changed from the page`)
      if (!valid(value))
        throw new OpsError(`${JSON.stringify(value)} is not a valid value for "${name}"`)
    }
    const index = attrs.findIndex((attr) => attrName(attr) === name)
    const attr = attrs[index]
    if (attr) {
      const current = attr.value as Node | null
      if (current !== null && literal(current) === undefined) {
        const expression =
          current.type === 'JSXExpressionContainer' ? (current.expression as Node) : current
        const source = code.slice(expression.start as number, expression.end as number)
        throw new OpsError(
          `"${name}" on "${title}" is computed in code (${source}) — change it in the source`,
          409,
        )
      }
      if (value === null) {
        const before =
          index > 0 ? (attrs[index - 1]?.end as number) : ((opening.name as Node).end as number)
        edits.push({ start: before, end: attr.end as number, text: '' })
      } else {
        edits.push({
          start: attr.start as number,
          end: attr.end as number,
          text: attributeText(name, value),
        })
      }
    } else if (value !== null) {
      inserts.push(attributeText(name, value))
    }
  }

  if (inserts.length) {
    const last = attrs[attrs.length - 1] ?? (opening.name as Node)
    const at = last.end as number
    const multiline = attrs.length > 1 && code.slice(attrs[0]?.start as number, at).includes('\n')
    const indent = multiline ? lineIndent(code, last.start as number) : ''
    edits.push({
      start: at,
      end: at,
      text: inserts.map((text) => (multiline ? `\n${indent}${text}` : ` ${text}`)).join(''),
    })
  }
  return splice(code, edits)
}

function ensureImport(code: string, name: string): string {
  const ast = strictParse(code)
  let declaration: Node | undefined
  walk(ast, (node) => {
    if (declaration || node.type !== 'ImportDeclaration') return
    if (
      (node.source as Node).value === '@open-database-dashboard/core' &&
      node.importKind !== 'type'
    )
      declaration = node
  })
  if (!declaration)
    throw new OpsError(
      'cannot find the import from @open-database-dashboard/core to add a component to',
      409,
    )
  const specifiers = (declaration.specifiers as Node[]).filter((s) => s.type === 'ImportSpecifier')
  const names = specifiers.map((s) => ((s.imported as Node).name as string) ?? '')
  if (names.includes(name)) return code
  const multiline =
    specifiers.length > 1 &&
    code.slice(specifiers[0]?.start as number, specifiers.at(-1)?.end as number).includes('\n')
  const after = specifiers.find(
    (s) => ((s.imported as Node).name as string).localeCompare(name, 'en') > 0,
  )
  if (after) {
    const at = after.start as number
    const text = multiline ? `${name},\n${lineIndent(code, at)}` : `${name}, `
    return splice(code, [{ start: at, end: at, text }])
  }
  const last = specifiers.at(-1)
  if (!last) throw new OpsError('the core import has no named imports to extend', 409)
  const at = last.end as number
  const trailing = /^\s*,/.exec(code.slice(at))
  if (trailing) {
    const end = at + trailing[0].length
    return splice(code, [
      {
        start: end,
        end,
        text: multiline ? `\n${lineIndent(code, last.start as number)}${name},` : ` ${name},`,
      },
    ])
  }
  return splice(code, [
    {
      start: at,
      end: at,
      text: multiline ? `,\n${lineIndent(code, last.start as number)}${name}` : `, ${name}`,
    },
  ])
}

function setComponent(code: string, title: string, to: PanelType): string {
  const ast = strictParse(code)
  const site = find(ast, title)
  if (!isPanelType(site.component)) throw new OpsError(`a ${site.component} cannot change type`)
  if (site.component === to) return code
  const props: Record<string, unknown> = {}
  for (const attr of attrNodes(site.node)) {
    const name = attrName(attr)
    if (name) props[name] = attr.value === null ? true : literal(attr.value as Node)
  }
  const changes = convertProps(site.component, to, props)
  const name = (site.node.openingElement as Node).name as Node
  const renames: Splice[] = [{ start: name.start as number, end: name.end as number, text: to }]
  const closing = site.node.closingElement as Node | null
  if (closing)
    renames.push({
      start: (closing.name as Node).start as number,
      end: (closing.name as Node).end as number,
      text: to,
    })
  const renamed = splice(code, renames)
  return ensureImport(setProps(renamed, title, changes, false), to)
}

function leadingMarker(parent: Node, element: Node, code: string): number {
  const children = (parent.children as Node[]) ?? []
  const index = children.indexOf(element)
  for (let i = index - 1; i >= 0; i -= 1) {
    const child = children[i] as Node
    if (child.type === 'JSXText' && !String(child.value).trim()) continue
    if (
      child.type === 'JSXExpressionContainer' &&
      (child.expression as Node).type === 'JSXEmptyExpression'
    ) {
      const text = code.slice(child.start as number, child.end as number)
      if (text.includes('@dashboard-comment')) return child.start as number
    }
    break
  }
  return element.start as number
}

function reorder(code: string, titles: string[]): string {
  const ast = strictParse(code)
  const found = titles.map((title) => find(ast, title))
  const parent = found[0]?.parent
  if (!parent || found.some((site) => site.parent !== parent)) {
    throw new OpsError('panels can only be reordered within the same row', 409)
  }
  const slots = siblingPanels(parent)
  const slotTitles = slots.map((node) => literal(attributes(node).get('title')))
  if (slots.length !== titles.length || !titles.every((title) => slotTitles.includes(title))) {
    throw new OpsError('the new order must list every panel of that row exactly once', 400)
  }
  const ranges = slots.map((node) => ({
    start: leadingMarker(parent, node, code),
    end: node.end as number,
  }))
  const textOf = new Map(
    slots.map((_, i) => [slotTitles[i] as string, code.slice(ranges[i]?.start, ranges[i]?.end)]),
  )
  return splice(
    code,
    ranges.map((range, i) => ({ ...range, text: textOf.get(titles[i] as string) as string })),
  )
}

/** From the start of the node's line (when it starts the line) through the end of its line. */
function lineSpan(code: string, start: number, end: number): { start: number; end: number } {
  const lineStart = code.lastIndexOf('\n', start - 1) + 1
  const from = /^[ \t]*$/.test(code.slice(lineStart, start)) ? lineStart : start
  const newline = code.indexOf('\n', end)
  const to = newline !== -1 && /^[ \t]*$/.test(code.slice(end, newline)) ? newline + 1 : end
  return { start: from, end: to }
}

function reindent(text: string, from: string, to: string): string {
  return text
    .split('\n')
    .map((line, i) =>
      i === 0 ? line : line.startsWith(from) ? to + line.slice(from.length) : line,
    )
    .join('\n')
}

function dropEmptyRows(code: string): string {
  const ast = strictParse(code)
  const empty = rowSites(ast).filter((site) => site.panels.length === 0)
  return splice(
    code,
    empty.map((site) => ({
      ...lineSpan(code, site.node.start as number, site.node.end as number),
      text: '',
    })),
  )
}

function structureCheck(ast: Node, edit: Extract<LayoutEdit, { kind: 'move' | 'moveRow' }>): void {
  try {
    applyStructure(shapes(ast), edit)
  } catch (error) {
    if (error instanceof StructureError) throw new OpsError(error.message, 409)
    throw error
  }
}

function move(code: string, title: string, row: number, index: number): string {
  const ast = strictParse(code)
  structureCheck(ast, { kind: 'move', title, row, index })
  const site = find(ast, title)
  const parent = site.parent as Node
  const start = leadingMarker(parent, site.node, code)
  const indent = lineIndent(code, start)
  const text = code.slice(start, site.node.end as number)
  const cut = splice(code, [{ ...lineSpan(code, start, site.node.end as number), text: '' }])

  const rows = rowSites(strictParse(cut))
  const target = rows[row] as RowSite
  const panels = target.panels
  const at = Math.max(0, Math.min(index, panels.length))
  let insertion: Splice
  if (at < panels.length) {
    const before = panels[at] as Node
    const beforeStart = leadingMarker(target.node, before, cut)
    const lineStart = cut.lastIndexOf('\n', beforeStart - 1) + 1
    const targetIndent = lineIndent(cut, beforeStart)
    insertion = {
      start: lineStart,
      end: lineStart,
      text: `${targetIndent}${reindent(text, indent, targetIndent)}\n`,
    }
  } else if (panels.length > 0) {
    const last = panels[panels.length - 1] as Node
    const targetIndent = lineIndent(cut, last.start as number)
    insertion = {
      start: last.end as number,
      end: last.end as number,
      text: `\n${targetIndent}${reindent(text, indent, targetIndent)}`,
    }
  } else {
    const opening = target.node.openingElement as Node
    const targetIndent = `${lineIndent(cut, target.node.start as number)}  `
    insertion = {
      start: opening.end as number,
      end: opening.end as number,
      text: `\n${targetIndent}${reindent(text, indent, targetIndent)}`,
    }
  }
  return dropEmptyRows(splice(cut, [insertion]))
}

function moveRow(code: string, from: number, to: number): string {
  const ast = strictParse(code)
  structureCheck(ast, { kind: 'moveRow', from, to })
  const rows = rowSites(ast)
  const parent = (rows[from] as RowSite).parent
  const slots = rows.map((site, i) => (site.parent === parent ? i : -1)).filter((i) => i >= 0)
  const texts = slots.map((i) => {
    const node = (rows[i] as RowSite).node
    return code.slice(node.start as number, node.end as number)
  })
  const order = [...slots]
  const [moved] = order.splice(slots.indexOf(from), 1)
  order.splice(slots.indexOf(to), 0, moved as number)
  return splice(
    code,
    slots.map((slot, k) => {
      const node = (rows[slot] as RowSite).node
      return {
        start: node.start as number,
        end: node.end as number,
        text: texts[slots.indexOf(order[k] as number)] as string,
      }
    }),
  )
}

export function applyEdit(code: string, edit: LayoutEdit): string {
  switch (edit.kind) {
    case 'props':
      return setProps(code, edit.title, edit.set, true)
    case 'component':
      if (!isPanelType(edit.component)) throw new OpsError(`unknown panel type "${edit.component}"`)
      return setComponent(code, edit.title, edit.component)
    case 'order':
      return reorder(code, edit.titles)
    case 'move':
      return move(code, edit.title, edit.row, edit.index)
    case 'moveRow':
      return moveRow(code, edit.from, edit.to)
    default:
      throw new OpsError(`unknown edit "${(edit as { kind?: string }).kind}"`)
  }
}

export function applyEdits(code: string, edits: LayoutEdit[]): string {
  return edits.reduce(applyEdit, code)
}

export function readLayout(config: ResolvedConfig, id: string): DashboardLayout {
  const file = dashboardFile(config, id)
  const code = readFileSync(file, 'utf8')
  const filters = analyzeDashboard(code)
    .filters.filter((f) => f.kind === 'Select' && f.name)
    .map((f) => f.name as string)
  return {
    hash: hashSource(code),
    file: relative(config.root, file),
    filters,
    ...describeLayout(code),
  }
}

/**
 * Every edit from one Save, applied in order to the file as it is now, written
 * once. Refused if the file changed since the page read it: the agent may be
 * editing it, and a stale splice would undo its work.
 */
export function editLayout(
  config: ResolvedConfig,
  id: string,
  edits: LayoutEdit[],
  hash: string,
): { hash: string } {
  if (!Array.isArray(edits) || edits.length === 0) throw new OpsError('nothing to save')
  const file = dashboardFile(config, id)
  const code = readFileSync(file, 'utf8')
  if (hashSource(code) !== hash) {
    throw new OpsError(
      'the dashboard changed on disk since you started editing (your agent may have edited it) — reload to see the latest, then redo your change',
      409,
    )
  }
  const next = applyEdits(code, edits)
  strictParse(next)
  writeFileSync(file, next)
  return { hash: hashSource(next) }
}
