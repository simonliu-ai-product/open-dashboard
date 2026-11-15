import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { ResolvedConfig } from '../workspace.js'
import { attributes, elementName, literal, parseSource, walk } from './analyze.js'
import { writeFileAtomic } from './atomic.js'
import { dashboardFile } from './dashboards.js'
import { OpsError } from './errors.js'

export const COMMENT_MARKER = '@dashboard-comment'

type Node = Parameters<typeof walk>[0]

/**
 * A note left in the viewer becomes a marker in the source, beside the panel it
 * is about, so the agent finds it where it will make the change. The source is
 * parsed strictly first: offsets from a recovered (broken) tree land in the
 * wrong place, and a misplaced splice corrupts the file.
 */
export function addComment(
  config: ResolvedConfig,
  id: string,
  panelTitle: string,
  text: string,
): { file: string; line: number } {
  const note = text.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim()
  if (!note) throw new OpsError('the comment is empty')
  const file = dashboardFile(config, id)
  const code = readFileSync(file, 'utf8')

  let ast: Node
  try {
    ast = parseSource(code, true)
  } catch (error) {
    throw new OpsError(
      `cannot place a comment while ${relative(config.root, file)} has a syntax error: ${(error as Error).message}`,
      409,
    )
  }

  let target: { node: Node; parent: Node | undefined } | undefined
  walk(ast, (node, parent) => {
    if (target || node.type !== 'JSXElement' || !elementName(node)) return
    if (literal(attributes(node).get('title')) === panelTitle) target = { node, parent }
  })
  if (!target) {
    throw new OpsError(`no panel titled "${panelTitle}" in ${relative(config.root, file)}`, 404)
  }

  const start = target.node.start as number
  const lineStart = code.lastIndexOf('\n', start - 1) + 1
  const before = code.slice(lineStart, start)
  const ownLine = /^\s*$/.test(before)
  const inJsx = target.parent?.type === 'JSXElement' || target.parent?.type === 'JSXFragment'
  const marker = inJsx ? `{/* ${COMMENT_MARKER}: ${note} */}` : `/* ${COMMENT_MARKER}: ${note} */`
  const insertion = ownLine ? `${marker}\n${before}` : `${marker} `

  writeFileAtomic(file, code.slice(0, start) + insertion + code.slice(start))
  return {
    file: relative(config.root, file),
    line: code.slice(0, start).split('\n').length,
  }
}

export interface DashboardNote {
  line: number
  text: string
  /** The panel the marker sits above, by title; null when it is not above a titled panel. */
  panel: string | null
}

const MARKER = new RegExp(`(\\{\\s*)?/\\*\\s*${COMMENT_MARKER}:\\s*(.*?)\\s*\\*/(\\s*\\})?`)

export function listComments(config: ResolvedConfig, id: string): DashboardNote[] {
  const code = readFileSync(dashboardFile(config, id), 'utf8')
  const out: DashboardNote[] = []
  code.split('\n').forEach((line, index) => {
    const match = MARKER.exec(line)
    if (match?.[2]) out.push({ line: index + 1, text: match[2], panel: null })
  })
  if (!out.length) return out
  // Each marker is about the first titled element that starts at or after it.
  const titled: { line: number; title: string }[] = []
  try {
    walk(parseSource(code), (node) => {
      if (node.type !== 'JSXElement' || !elementName(node)) return
      const title = literal(attributes(node).get('title'))
      const line = (node.loc as { start: { line: number } } | undefined)?.start.line
      if (typeof title === 'string' && line) titled.push({ line, title })
    })
  } catch {
    return out
  }
  titled.sort((a, b) => a.line - b.line)
  for (const note of out) note.panel = titled.find((t) => t.line >= note.line)?.title ?? null
  return out
}

/**
 * Removes one note: the marker on `line` whose text is `text` (so a file that
 * moved underneath is refused, not mangled). A line left blank goes with it.
 */
export function resolveComment(
  config: ResolvedConfig,
  id: string,
  line: number,
  text: string,
): { file: string; remaining: number } {
  const file = dashboardFile(config, id)
  const lines = readFileSync(file, 'utf8').split('\n')
  const at = lines[line - 1]
  const match = at === undefined ? null : MARKER.exec(at)
  if (!match || match[2] !== text) {
    throw new OpsError(
      `the note "${text}" is no longer on line ${line} of ${relative(config.root, file)}; reload and try again`,
      409,
    )
  }
  const rest = (at as string).replace(match[0], '').replace(/^(\s*)\s(?=\S)/, '$1')
  if (/^\s*$/.test(rest)) lines.splice(line - 1, 1)
  else lines[line - 1] = rest
  writeFileAtomic(file, lines.join('\n'))
  return { file: relative(config.root, file), remaining: listComments(config, id).length }
}
