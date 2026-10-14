import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parse } from '@babel/parser'
import { columnProps, PANEL_NAMES } from '../runtime/convert.js'

type Node = {
  type: string
  start?: number | null
  end?: number | null
  loc?: { start: { line: number; column: number } } | null
  [key: string]: unknown
}

export interface FilterDecl {
  kind: 'TimeRange' | 'Select' | 'MultiSelect' | 'SearchInput' | 'Toggle'
  name: string | undefined
  default: string | null | undefined
  /** TimeRange only: whether it also binds `:prev_from` and `:prev_to`. */
  compare?: boolean
  /** Select only: the query that lists its options. */
  query?: string
  /** The choices written as a literal `options` array: presets, or a Select's values. */
  options?: string[]
  /** A Select's literal `{ value, label }` options, by value. */
  optionLabels?: Record<string, string>
  label?: string
  allowAll: boolean
  line: number
}

export interface PanelRef {
  component: string
  title: string | undefined
  query: string | undefined
  /** Column names the panel names literally, to be checked against the result. */
  columns: string[]
  /** The filter a click on this panel sets, and the dashboard it opens, if any. */
  drill?: { filter: string; dashboard?: string }
  line: number
}

export interface QueryRef {
  name: string
  line: number
  /** Column names read from this query's result. */
  columns: string[]
}

export interface DashboardAnalysis {
  meta: Record<string, string | number | boolean>
  filters: FilterDecl[]
  panels: PanelRef[]
  queryRefs: QueryRef[]
}

export function parseSource(code: string, strict = false): Node {
  return parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
    errorRecovery: !strict,
  }) as unknown as Node
}

function children(node: Node): Node[] {
  const out: Node[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'extra')
      continue
    if (Array.isArray(value)) {
      for (const item of value)
        if (item && typeof item === 'object' && 'type' in item) out.push(item as Node)
    } else if (value && typeof value === 'object' && 'type' in value) {
      out.push(value as Node)
    }
  }
  return out
}

export function walk(
  node: Node,
  visit: (node: Node, parent: Node | undefined) => void,
  parent?: Node,
): void {
  visit(node, parent)
  for (const child of children(node)) walk(child, visit, node)
}

/** Top-level `const` values by name: what `literal` may look up when a prop names one. */
export type Constants = ReadonlyMap<string, Node>

function topLevelConsts(ast: Node, exportedOnly: boolean): Map<string, Node> {
  const out = new Map<string, Node>()
  const program = (ast.program ?? ast) as Node
  for (const statement of (program.body as Node[] | undefined) ?? []) {
    const exported = statement.type === 'ExportNamedDeclaration'
    const declaration = (exported ? statement.declaration : statement) as Node | null
    if (declaration?.type !== 'VariableDeclaration') continue
    if (declaration.kind !== 'const' || (exportedOnly && !exported)) continue
    for (const declarator of declaration.declarations as Node[]) {
      const id = declarator.id as Node
      if (id.type === 'Identifier' && declarator.init)
        out.set(id.name as string, declarator.init as Node)
    }
  }
  return out
}

const EXTENSIONS = [
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '/index.tsx',
  '/index.ts',
  '/index.jsx',
  '/index.js',
]

/**
 * The constants a dashboard's props may name: its own top-level `const`s, and
 * the ones it imports by name from a relative file that exports them — one
 * hop, read statically, never run. `options={GAMES}` with `GAMES` shared by
 * three dashboards is still a literal list.
 */
export function constantsOf(ast: Node, file?: string): Map<string, Node> {
  const out = topLevelConsts(ast, false)
  if (!file) return out
  const program = (ast.program ?? ast) as Node
  for (const statement of (program.body as Node[] | undefined) ?? []) {
    if (statement.type !== 'ImportDeclaration') continue
    const from = (statement.source as Node).value as string
    if (!from.startsWith('.')) continue
    const base = resolve(dirname(file), from)
    const target = [base, ...EXTENSIONS.map((ext) => base + ext)].find(
      (path) => /\.[jt]sx?$/.test(path) && existsSync(path),
    )
    if (!target) continue
    let exported: Map<string, Node>
    try {
      exported = topLevelConsts(parseSource(readFileSync(target, 'utf8')), true)
    } catch {
      continue
    }
    for (const specifier of statement.specifiers as Node[]) {
      if (specifier.type !== 'ImportSpecifier') continue
      const imported = specifier.imported as Node
      const name = (imported.name ?? imported.value) as string
      const value = exported.get(name)
      if (value && !out.has((specifier.local as Node).name as string))
        out.set((specifier.local as Node).name as string, value)
    }
  }
  return out
}

export function literal(node: Node | undefined | null, constants?: Constants): unknown {
  if (!node) return undefined
  switch (node.type) {
    case 'Identifier': {
      const value = constants?.get(node.name as string)
      if (!value) return undefined
      // A constant naming itself, directly or not, ends here instead of looping.
      const rest = new Map(constants)
      rest.delete(node.name as string)
      return literal(value, rest)
    }
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return node.value
    case 'NullLiteral':
      return null
    case 'TemplateLiteral': {
      const quasis = node.quasis as Node[]
      if ((node.expressions as Node[]).length > 0) return undefined
      return (quasis[0]?.value as { cooked?: string })?.cooked
    }
    case 'JSXExpressionContainer':
      return literal(node.expression as Node, constants)
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return literal(node.expression as Node, constants)
    case 'ArrayExpression':
      return (node.elements as Node[]).map((element) => literal(element, constants))
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {}
      for (const property of node.properties as Node[]) {
        if (property.type !== 'ObjectProperty') continue
        const key = property.key as Node
        const name =
          key.type === 'Identifier'
            ? key.name
            : key.type === 'StringLiteral'
              ? key.value
              : undefined
        if (typeof name === 'string') out[name] = literal(property.value as Node, constants)
      }
      return out
    }
    default:
      return undefined
  }
}

export function elementName(node: Node): string | undefined {
  const name = (node.openingElement as Node | undefined)?.name as Node | undefined
  if (!name) return undefined
  if (name.type === 'JSXIdentifier') return name.name as string
  if (name.type === 'JSXMemberExpression')
    return ((name.property as Node).name as string) ?? undefined
  return undefined
}

export function attributes(node: Node): Map<string, Node | null> {
  const out = new Map<string, Node | null>()
  for (const attr of ((node.openingElement as Node).attributes as Node[]) ?? []) {
    if (attr.type !== 'JSXAttribute') continue
    out.set(((attr.name as Node).name as string) ?? '', (attr.value as Node | null) ?? null)
  }
  return out
}

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  return []
}

/** Column names inside a prop: a string, an array of them, or an object's values (`stats={{ q1: 'p25' }}`). */
function columnsIn(value: unknown): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.values(value).flatMap(stringsIn)
  return stringsIn(value)
}

function line(node: Node): number {
  return node.loc?.start.line ?? 0
}

export function readMeta(code: string): Record<string, string | number | boolean> {
  return analyzeDashboard(code).meta
}

/**
 * Reads only what is written literally — in the prop, or in a constant it
 * names (`constantsOf`). A prop computed at runtime is invisible here, which
 * is fine: this feeds `check` and the dashboard list, and both say less rather
 * than guess.
 */
export function analyzeDashboard(
  code: string,
  /** Custom charts by the name the dashboard uses, and the props of each that name columns. */
  custom: ReadonlyMap<string, readonly string[]> = new Map(),
  /** The dashboard's file: constants imported from relative files are followed from it. */
  file?: string,
): DashboardAnalysis {
  const ast = parseSource(code)
  const constants = constantsOf(ast, file)
  const result: DashboardAnalysis = { meta: {}, filters: [], panels: [], queryRefs: [] }

  walk(ast, (node) => {
    if (node.type === 'VariableDeclarator' && (node.id as Node).name === 'meta') {
      const value = literal(node.init as Node)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, v] of Object.entries(value)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
            result.meta[key] = v
        }
      }
      return
    }
    if (node.type !== 'JSXElement') return
    const name = elementName(node)
    if (!name) return
    const attrs = attributes(node)
    const read = (key: string) => (attrs.has(key) ? literal(attrs.get(key), constants) : undefined)

    if (
      name === 'TimeRange' ||
      name === 'Select' ||
      name === 'MultiSelect' ||
      name === 'SearchInput' ||
      name === 'Toggle'
    ) {
      const raw = read('default')
      const query = read('query')
      const decl: FilterDecl = {
        kind: name,
        name: typeof read('name') === 'string' ? (read('name') as string) : undefined,
        default:
          typeof raw === 'string' || raw === null
            ? raw
            : Array.isArray(raw)
              ? raw.map(String).join(',')
              : typeof raw === 'boolean'
                ? raw
                  ? '1'
                  : '0'
                : undefined,
        allowAll: read('allowAll') !== false,
        line: line(node),
      }
      if (name === 'TimeRange' && (read('compare') === true || attrs.get('compare') === null)) {
        decl.compare = true
      }
      const options = read('options')
      if (Array.isArray(options)) {
        const values = options.map((option) =>
          typeof option === 'string'
            ? option
            : typeof (option as { value?: unknown } | undefined)?.value === 'string'
              ? (option as { value: string }).value
              : undefined,
        )
        if (values.every((value) => value !== undefined)) decl.options = values as string[]
        const labels: Record<string, string> = {}
        for (const option of options as { value?: unknown; label?: unknown }[])
          if (typeof option?.value === 'string' && typeof option.label === 'string')
            labels[option.value] = option.label
        if (Object.keys(labels).length) decl.optionLabels = labels
      }
      const label = read('label')
      if (typeof label === 'string') decl.label = label
      if (typeof query === 'string') {
        decl.query = query
        result.queryRefs.push({ name: query, line: line(node), columns: [] })
      }
      result.filters.push(decl)
      return
    }

    const customColumns = custom.get(name)
    if (!PANEL_NAMES.has(name) && !customColumns) return
    const query = read('query')
    const columns: string[] = []
    for (const prop of customColumns ?? columnProps(name)) columns.push(...columnsIn(read(prop)))
    const tableColumns = read('columns')
    if (Array.isArray(tableColumns)) {
      for (const column of tableColumns) {
        if (typeof column === 'string') columns.push(column)
        else if (
          column &&
          typeof column === 'object' &&
          typeof (column as { key?: unknown }).key === 'string'
        ) {
          columns.push((column as { key: string }).key)
        }
      }
    }
    const drill = read('drill')
    const drillTo = read('drillTo')
    const panel: PanelRef = {
      component: name,
      title: typeof read('title') === 'string' ? (read('title') as string) : undefined,
      query: typeof query === 'string' ? query : undefined,
      columns,
      line: line(node),
    }
    if (typeof drill === 'string') {
      panel.drill = {
        filter: drill,
        ...(typeof drillTo === 'string' ? { dashboard: drillTo } : {}),
      }
    } else if (
      drill &&
      typeof drill === 'object' &&
      typeof (drill as { filter?: unknown }).filter === 'string'
    ) {
      const spec = drill as {
        filter: string
        column?: unknown
        dashboard?: unknown
        drillTo?: unknown
      }
      panel.drill = { filter: spec.filter }
      const targetDash =
        typeof spec.dashboard === 'string'
          ? spec.dashboard
          : typeof spec.drillTo === 'string'
            ? spec.drillTo
            : typeof drillTo === 'string'
              ? drillTo
              : undefined
      if (targetDash) panel.drill.dashboard = targetDash
      if (typeof spec.column === 'string') columns.push(spec.column)
    }
    result.panels.push(panel)
    if (panel.query) result.queryRefs.push({ name: panel.query, line: panel.line, columns })

    const holidays = read('holidays')
    if (typeof holidays === 'string')
      result.queryRefs.push({ name: holidays, line: panel.line, columns: [] })

    const spark = read('spark')
    if (spark && typeof spark === 'object' && !Array.isArray(spark)) {
      const s = spark as { query?: unknown; x?: unknown; y?: unknown }
      const sparkQuery = typeof s.query === 'string' ? s.query : panel.query
      if (sparkQuery)
        result.queryRefs.push({
          name: sparkQuery,
          line: panel.line,
          columns: [...stringsIn(s.x), ...stringsIn(s.y)],
        })
    }
  })

  return result
}
