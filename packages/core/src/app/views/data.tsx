import { useEffect, useState } from 'react'
import type { SchemaInfo } from '../../config.js'
import type { SourceStatus } from '../../ops/sources.js'
import { api } from '../lib/api.js'
import { linkProps } from '../lib/router.js'

export function DataSourcesView({ source }: { source?: string }) {
  const [sources, setSources] = useState<SourceStatus[]>()
  const [schema, setSchema] = useState<SchemaInfo>()
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState('')

  useEffect(() => {
    api.sources().then(setSources, (e: Error) => setError(e.message))
  }, [])

  const selected = source ?? sources?.find((s) => s.default)?.name ?? sources?.[0]?.name

  useEffect(() => {
    if (!selected) return
    setSchema(undefined)
    setError(undefined)
    api.schema(selected).then(setSchema, (e: Error) => setError(e.message))
  }, [selected])

  const tables =
    schema?.tables.filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase())) ??
    []

  return (
    <div className="odd-page">
      <header className="odd-page-head">
        <h1>Data sources</h1>
        <p>
          What your agent sees when it runs <code>open-dashboard schema</code>. Every query runs
          read-only.
        </p>
      </header>
      <div className="odd-tabs" role="tablist">
        {sources?.map((s) => (
          <a
            key={s.name}
            role="tab"
            aria-selected={s.name === selected}
            {...linkProps(`/data/${encodeURIComponent(s.name)}`)}
          >
            <span className="odd-status" data-ok={s.ok}>
              {s.ok ? '●' : '▲'}
            </span>
            {s.name} <span className="odd-muted">{s.type}</span>
          </a>
        ))}
      </div>
      {error ? <p className="odd-callout odd-callout-error">{error}</p> : null}
      {schema ? (
        <>
          <input
            className="odd-search"
            type="search"
            placeholder={`Filter ${schema.tables.length} tables`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="odd-schema">
            {tables.map((table) => (
              <section key={`${table.schema ?? ''}.${table.name}`} className="odd-schema-table">
                <header>
                  <h2>
                    {table.schema && table.schema !== 'public'
                      ? `${table.schema}.${table.name}`
                      : table.name}
                  </h2>
                  <span className="odd-muted">
                    {table.kind}
                    {table.rowCount !== undefined
                      ? ` · ${table.rowCount.toLocaleString()} rows`
                      : ''}
                  </span>
                </header>
                <table>
                  <tbody>
                    {table.columns.map((column) => {
                      const fk = table.foreignKeys.find((f) => f.column === column.name)
                      return (
                        <tr key={column.name}>
                          <td className="odd-schema-col">
                            {column.name}
                            {column.primaryKey ? <span className="odd-badge">PK</span> : null}
                          </td>
                          <td className="odd-muted">{column.type}</td>
                          <td className="odd-muted">
                            {fk
                              ? `→ ${fk.table}.${fk.references}`
                              : column.nullable
                                ? ''
                                : 'not null'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        </>
      ) : !error && selected ? (
        <p className="odd-muted">Reading schema…</p>
      ) : null}
    </div>
  )
}
