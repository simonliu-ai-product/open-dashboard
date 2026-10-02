import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { ResolvedConfig } from '../workspace.js'
import { attributes, elementName, literal, parseSource, walk } from './analyze.js'
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

  writeFileSync(file, code.slice(0, start) + insertion + code.slice(start))
  return {
    file: relative(config.root, file),
    line: code.slice(0, start).split('\n').length,
  }
}

export function listComments(config: ResolvedConfig, id: string): { line: number; text: string }[] {
  const code = readFileSync(dashboardFile(config, id), 'utf8')
  const out: { line: number; text: string }[] = []
  code.split('\n').forEach((line, index) => {
    const match = new RegExp(`${COMMENT_MARKER}:\\s*(.*?)\\s*\\*/`).exec(line)
    if (match?.[1]) out.push({ line: index + 1, text: match[1] })
  })
  return out
}
