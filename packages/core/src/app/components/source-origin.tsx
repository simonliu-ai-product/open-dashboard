import { useMemo, useState } from 'react'
import type { TableInfo } from '../../config.js'
import type { HttpEndpoint, McpToolTable, SourceDetail } from '../../ops/sources.js'
import { useT } from '../../runtime/i18n.js'

type Detail = Exclude<SourceDetail, { kind: 'database' }>

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return `${parsed.host}${parsed.pathname.replace(/\/$/, '')}`
  } catch {
    return url
  }
}

/** A URL or argument with its `:name` parameters marked. */
function WithParams({ text }: { text: string }) {
  const parts = text.split(/(:[A-Za-z_][A-Za-z0-9_]*)/g)
  return (
    <>
      {parts.map((part, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: parts of one string, in order
        /^:[A-Za-z_]/.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  )
}

function Rows({ table, tables }: { table: string; tables: Map<string, TableInfo> }) {
  const t = useT()
  const info = tables.get(table)
  if (info?.rowCount === undefined) return null
  return <span>{t('{n} rows', { n: info.rowCount.toLocaleString() })}</span>
}

function Safety({ readOnly, destructive }: { readOnly?: boolean; destructive?: boolean }) {
  const t = useT()
  if (destructive)
    return (
      <span className="odd-safety" data-tone="critical">
        {t('Destructive')}
      </span>
    )
  if (readOnly)
    return (
      <span className="odd-safety" data-tone="good">
        {t('Read-only')}
      </span>
    )
  return (
    <span className="odd-safety" data-tone="warning">
      {t('Not annotated')}
    </span>
  )
}

function Endpoint({
  endpoint,
  tables,
}: {
  endpoint: HttpEndpoint
  tables: Map<string, TableInfo>
}) {
  const t = useT()
  return (
    <li>
      <span className="odd-method">{endpoint.method}</span>
      <code className="odd-origin-call">
        <WithParams text={endpoint.url} />
      </code>
      <a className="odd-origin-table" href={`#table-${endpoint.table}`}>
        {endpoint.table}
      </a>
      <span className="odd-origin-meta">
        <Rows table={endpoint.table} tables={tables} />
        {endpoint.params.length ? (
          <span>
            {t('needs {names}', { names: endpoint.params.map((p) => `:${p}`).join(', ') })}
          </span>
        ) : null}
      </span>
    </li>
  )
}

function ToolTable({ table, tables }: { table: McpToolTable; tables: Map<string, TableInfo> }) {
  const t = useT()
  const args = Object.entries(table.args)
  return (
    <li>
      <Safety
        {...(table.readOnly !== undefined ? { readOnly: table.readOnly } : {})}
        {...(table.destructive ? { destructive: true } : {})}
      />
      <code className="odd-origin-call">
        {table.tool}
        <span className="odd-origin-args">
          (
          {args.map(([key, value], i) => (
            <span key={key}>
              {i ? ', ' : ''}
              {key} ={' '}
              <WithParams text={typeof value === 'string' ? value : JSON.stringify(value)} />
            </span>
          ))}
          )
        </span>
      </code>
      <a className="odd-origin-table" href={`#table-${table.table}`}>
        {table.table}
      </a>
      <span className="odd-origin-meta">
        <Rows table={table.table} tables={tables} />
        {table.params.length ? (
          <span>{t('needs {names}', { names: table.params.map((p) => `:${p}`).join(', ') })}</span>
        ) : null}
      </span>
    </li>
  )
}

function OtherTools({ detail }: { detail: Extract<Detail, { kind: 'mcp' }> }) {
  const t = useT()
  const [filter, setFilter] = useState('')
  const used = new Set(detail.tables.map((table) => table.tool))
  const others = detail.tools.filter((tool) => !used.has(tool.name))
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return others.filter(
      (tool) =>
        !needle ||
        tool.name.toLowerCase().includes(needle) ||
        (tool.title ?? '').toLowerCase().includes(needle) ||
        (tool.description ?? '').toLowerCase().includes(needle) ||
        (tool.search ?? '').toLowerCase().includes(needle),
    )
  }, [others, filter])
  if (others.length === 0) return null
  return (
    <details className="odd-origin-more">
      <summary>{t('Other tools on this server ({n})', { n: others.length })}</summary>
      <input
        className="odd-search"
        type="search"
        placeholder={t('Filter {n} tools', { n: others.length })}
        aria-label={t('Filter tools')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="odd-tool-list">
        {shown.slice(0, 200).map((tool) => (
          <li key={tool.name}>
            <Safety
              {...(tool.readOnly !== undefined ? { readOnly: tool.readOnly } : {})}
              {...(tool.destructive ? { destructive: true } : {})}
            />
            <code>{tool.name}</code>
            <span>{tool.title ?? tool.description ?? ''}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Where an API or MCP source's tables come from — the part a database does not have. */
export function SourceOrigin({ detail, tables }: { detail: Detail; tables: TableInfo[] }) {
  const t = useT()
  const byName = new Map(tables.map((table) => [table.name, table]))
  if (detail.kind === 'http') {
    return (
      <section className="odd-origin" data-kind="http">
        <header>
          <h2>{t('Endpoints')}</h2>
          {detail.base ? <code>{hostOf(detail.base)}</code> : null}
          <span className="odd-safety" data-tone="good">
            {t('GET only')}
          </span>
          {detail.headers.length ? (
            <span className="odd-origin-note">
              {t('Headers: {names}', { names: detail.headers.join(', ') })}
            </span>
          ) : null}
        </header>
        <ul className="odd-origin-list">
          {detail.endpoints.map((endpoint) => (
            <Endpoint key={endpoint.table} endpoint={endpoint} tables={byName} />
          ))}
        </ul>
      </section>
    )
  }
  const readOnly = detail.tools.filter((tool) => tool.readOnly).length
  return (
    <section className="odd-origin" data-kind="mcp">
      <header>
        <h2>{t('Tools')}</h2>
        <code>{detail.transport === 'http' ? hostOf(detail.endpoint) : detail.endpoint}</code>
        <span className="odd-origin-note">
          {detail.transport === 'http' ? t('streamable HTTP') : t('stdio')}
          {detail.server?.name
            ? ` · ${detail.server.name}${detail.server.version ? ` ${detail.server.version}` : ''}`
            : ''}
        </span>
        {detail.tools.length ? (
          <span
            className="odd-safety"
            data-tone={readOnly === detail.tools.length ? 'good' : 'warning'}
          >
            {readOnly === detail.tools.length
              ? t('{n} tools, all read-only', { n: detail.tools.length })
              : t('{n} tools, {m} read-only', { n: detail.tools.length, m: readOnly })}
          </span>
        ) : null}
      </header>
      {detail.error ? <p className="odd-origin-error">{detail.error}</p> : null}
      <ul className="odd-origin-list">
        {detail.tables.map((table) => (
          <ToolTable key={table.table} table={table} tables={byName} />
        ))}
      </ul>
      <OtherTools detail={detail} />
    </section>
  )
}
