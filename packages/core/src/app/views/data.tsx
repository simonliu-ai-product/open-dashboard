import { useEffect, useState } from 'react'
import type { SchemaInfo } from '../../config.js'
import { driverFor } from '../../datasource/registry.js'
import type { SourceStatus } from '../../ops/sources.js'
import { useT } from '../../runtime/i18n.js'
import { CommandButton } from '../components/command-button.js'
import { api } from '../lib/api.js'

function SourceError({ message }: { message: string }) {
  const t = useT()
  return (
    <section className="odd-source-error" role="alert">
      <div className="odd-source-error-body">
        <strong>{t('Cannot connect')}</strong>
        <code>{message}</code>
      </div>
      <CommandButton command="/connect-database" />
    </section>
  )
}

export function DataSourcesView({
  source,
  sources,
}: {
  source?: string
  /** From the shell, which reloads it when the config or .env changes. */
  sources: SourceStatus[] | undefined
}) {
  const t = useT()
  const [schema, setSchema] = useState<SchemaInfo>()
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState('')

  const selected = source ?? sources?.find((s) => s.default)?.name ?? sources?.[0]?.name
  const current = sources?.find((s) => s.name === selected)

  // Re-read when the list is reloaded too: a fixed connection string should
  // show its tables without a page refresh.
  useEffect(() => {
    if (!selected || !sources) return
    if (current && !current.ok) {
      setSchema(undefined)
      setError(undefined)
      return
    }
    let live = true
    setSchema(undefined)
    setError(undefined)
    api.schema(selected).then(
      (found) => live && setSchema(found),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [selected, sources, current])

  const tables =
    schema?.tables.filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase())) ??
    []

  return (
    <div className="odd-page">
      <header className="odd-page-head">
        {current ? (
          <h1 className="odd-source-title">
            {current.name}
            <span>{driverFor(current.type)?.label ?? current.type}</span>
          </h1>
        ) : (
          <h1>{t('Data sources')}</h1>
        )}
      </header>
      {sources?.length === 0 ? (
        <ol className="odd-setup">
          <li data-state="current">
            <span className="odd-setup-mark" aria-hidden="true">
              1
            </span>
            <div className="odd-setup-body">
              <h2>{t('Connect a database')}</h2>
              <CommandButton command="/connect-database" />
            </div>
          </li>
        </ol>
      ) : null}
      {current && !current.ok ? (
        <SourceError message={current.error ?? t('Not connected')} />
      ) : current && error ? (
        <SourceError message={error} />
      ) : null}
      {schema ? (
        <>
          <input
            className="odd-search"
            type="search"
            placeholder={t('Filter {n} tables', { n: schema.tables.length })}
            aria-label={t('Filter tables')}
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
                    {table.rowCount !== undefined
                      ? t(table.kind === 'view' ? 'View, {n} rows' : '{n} rows', {
                          n: table.rowCount.toLocaleString(),
                        })
                      : t(table.kind === 'view' ? 'View' : 'Table')}
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
                                : t('not null')}
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
      ) : !error && current?.ok ? (
        <p className="odd-muted">{t('Reading schema…')}</p>
      ) : null}
    </div>
  )
}
