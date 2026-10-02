import { Fragment, type ReactNode } from 'react'

/**
 * Just enough Markdown for a database.md: headings, paragraphs, lists, fenced
 * code, quotes; inline code, bold, italics and links. Rendered as React
 * elements, never as HTML, so a file can't inject anything into the page.
 */
export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] as string
    if (!line.trim()) {
      i += 1
      continue
    }
    const fence = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !(lines[i] as string).trim().startsWith(fence[1] as string)) {
        body.push(lines[i] as string)
        i += 1
      }
      blocks.push({ kind: 'code', text: body.join('\n') })
      i += 1
      continue
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] as string).length, text: heading[2] ?? '' })
      i += 1
      continue
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      const ordered = /\d/.test(item[1] as string)
      const items: string[] = []
      while (i < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i] as string)
        if (next) {
          items.push(next[2] ?? '')
        } else if ((lines[i] as string).trim() && /^\s{2,}/.test(lines[i] as string)) {
          // An indented line continues the item above.
          items[items.length - 1] += ` ${(lines[i] as string).trim()}`
        } else break
        i += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i] as string)) {
        body.push((lines[i] as string).replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push({ kind: 'quote', text: body.join(' ') })
      continue
    }
    const body: string[] = []
    while (
      i < lines.length &&
      (lines[i] as string).trim() &&
      !/^(#{1,6}\s|\s*([-*+]|\d+[.)])\s|\s*>|\s*(```|~~~))/.test(lines[i] as string)
    ) {
      body.push((lines[i] as string).trim())
      i += 1
    }
    blocks.push({ kind: 'paragraph', text: body.join(' ') })
  }
  return blocks
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/

export function Inline({ text }: { text: string }): ReactNode {
  const out: ReactNode[] = []
  let rest = text
  let key = 0
  while (rest) {
    const match = INLINE.exec(rest)
    if (!match) {
      out.push(rest)
      break
    }
    if (match.index > 0) out.push(rest.slice(0, match.index))
    const token = match[0]
    if (match[1]) out.push(<code key={key++}>{token.slice(1, -1)}</code>)
    else if (match[2]) out.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    else if (match[3]) out.push(<em key={key++}>{token.slice(1, -1)}</em>)
    else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
      const href = link?.[2] ?? ''
      out.push(
        /^https?:\/\//.test(href) ? (
          <a key={key++} href={href} target="_blank" rel="noreferrer">
            {link?.[1]}
          </a>
        ) : (
          link?.[1]
        ),
      )
    }
    rest = rest.slice(match.index + token.length)
  }
  return <>{out}</>
}

export function Blocks({ blocks }: { blocks: Block[] }): ReactNode {
  return (
    <>
      {blocks.map((block, i) => {
        const key = `${block.kind}-${i}`
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${Math.min(6, block.level + 1)}` as 'h3'
            return (
              <Tag key={key}>
                <Inline text={block.text} />
              </Tag>
            )
          }
          case 'paragraph':
            return (
              <p key={key}>
                <Inline text={block.text} />
              </p>
            )
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul'
            return (
              <Tag key={key}>
                {block.items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: items have no identity of their own
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </Tag>
            )
          }
          case 'code':
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            )
          case 'quote':
            return (
              <blockquote key={key}>
                <Inline text={block.text} />
              </blockquote>
            )
          default:
            return <Fragment key={key} />
        }
      })}
    </>
  )
}

export interface TableDoc {
  /** Prose about the table: everything in its section but the column notes. */
  about: Block[]
  /** Column name (lower case) → its note. */
  columns: Map<string, string>
}

export interface DatabaseDocParts {
  title: string | undefined
  /** Before the first `##`. */
  overview: Block[]
  /** Every `##` section except Tables, in order. */
  sections: { heading: string; blocks: Block[] }[]
  /** Table name (lower case, schema-qualified or not) → its notes. */
  tables: Map<string, TableDoc>
}

const TABLES_HEADING = /^(tables|資料表|数据表|テーブル|테이블)$/i
const COLUMN_NOTE = /^`([^`]+)`\s*(?:[—–:-]\s*|\s+)(.*)$/

/**
 * Splits a database.md the way the schema page shows it: the overview and the
 * other sections beside the tables, and each `### <table>` under `## Tables`
 * on that table's card, with a list item that starts with a `column` name
 * attached to that column.
 */
export function splitDatabaseDoc(markdown: string): DatabaseDocParts {
  const parts: DatabaseDocParts = {
    title: undefined,
    overview: [],
    sections: [],
    tables: new Map(),
  }
  let section: { heading: string; blocks: Block[] } | undefined
  let inTables = false
  let table: TableDoc | undefined
  for (const block of parseBlocks(markdown)) {
    if (block.kind === 'heading' && block.level === 1 && parts.title === undefined && !section) {
      parts.title = block.text
      continue
    }
    if (block.kind === 'heading' && block.level === 2) {
      inTables = TABLES_HEADING.test(block.text.trim())
      table = undefined
      section = inTables ? undefined : { heading: block.text, blocks: [] }
      if (section) parts.sections.push(section)
      continue
    }
    if (inTables) {
      if (block.kind === 'heading' && block.level === 3) {
        table = { about: [], columns: new Map() }
        parts.tables.set(block.text.replaceAll('`', '').trim().toLowerCase(), table)
        continue
      }
      if (!table) continue
      if (block.kind === 'list') {
        const rest: string[] = []
        for (const item of block.items) {
          const note = COLUMN_NOTE.exec(item)
          if (note) table.columns.set((note[1] as string).toLowerCase(), note[2] ?? '')
          else rest.push(item)
        }
        if (rest.length) table.about.push({ ...block, items: rest })
      } else table.about.push(block)
      continue
    }
    if (section) section.blocks.push(block)
    else parts.overview.push(block)
  }
  return parts
}
