import { useEffect, useMemo, useState } from 'react'
import type { SchemaInfo } from '../../config.js'
import { driverFor } from '../../datasource/registry.js'
import type { DatabaseDoc } from '../../ops/database-doc.js'
import type { SourceDetail, SourceStatus } from '../../ops/sources.js'
import { useLocale, useT } from '../../runtime/i18n.js'
import { Blocks, Inline, splitDatabaseDoc } from '../../runtime/markdown.js'
import { CommandButton } from '../components/command-button.js'
import { SourceOrigin } from '../components/source-origin.js'
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

function useDatabaseDoc(source: string | undefined): DatabaseDoc | undefined {
  const [doc, setDoc] = useState<DatabaseDoc>()
  useEffect(() => {
    if (!source) return
    let live = true
    const load = () =>
      api.databaseDoc(source).then(
        (found) => live && setDoc(found),
        () => live && setDoc(undefined),
      )
    setDoc(undefined)
    load()
    const onChange = (data: unknown) => {
      if ((data as { source?: string } | undefined)?.source === source) load()
    }
    import.meta.hot?.on('odd:database-doc-changed', onChange)
    return () => {
      live = false
      import.meta.hot?.off?.('odd:database-doc-changed', onChange)
    }
  }, [source])
  return doc
}

function isJsonSource(type: string): boolean {
  return type === 'http' || type === 'mcp'
}

function useSourceDetail(
  source: string | undefined,
  reload: unknown,
): Exclude<SourceDetail, { kind: 'database' }> | undefined {
  const [detail, setDetail] = useState<SourceDetail>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the sources list reloads (config edits)
  useEffect(() => {
    setDetail(undefined)
    if (!source) return
    let live = true
    api.sourceDetail(source).then(
      (found) => live && setDetail(found),
      () => live && setDetail(undefined),
    )
    return () => {
      live = false
    }
  }, [source, reload])
  return detail && detail.kind !== 'database' ? detail : undefined
}

/** The database.md overview and notes: the top of the page, at reading width. */
function DatabaseIntro({ doc, source }: { doc: DatabaseDoc; source: string }) {
  const parts = useMemo(() => (doc.markdown ? splitDatabaseDoc(doc.markdown) : undefined), [doc])
  if (!parts) {
    return (
      <div className="odd-db-intro">
        <CommandButton command={`/document-database ${source}`} />
      </div>
    )
  }
  return (
    <div className="odd-db-intro odd-prose" title={doc.file}>
      <Blocks blocks={parts.overview} />
      {parts.sections.map((section) => (
        <section key={section.heading} className="odd-db-section">
          <h2>
            <Inline text={section.heading} />
          </h2>
          <Blocks blocks={section.blocks} />
        </section>
      ))}
    </div>
  )
}

/** The table section at the top of the view, for the contents list to mark. */
function useCurrentSection(ids: string[]): string | undefined {
  const [current, setCurrent] = useState<string>()
  useEffect(() => {
    if (ids.length === 0) return
    const scroller = document.querySelector('.odd-main') ?? window
    const update = () => {
      let found: string | undefined
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 96) found = id
      }
      setCurrent(found)
    }
    update()
    scroller.addEventListener('scroll', update, { passive: true })
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', update)
      window.removeEventListener('scroll', update)
    }
  }, [ids])
  return current
}

type DataView = 'docs' | 'schema'
const VIEW_KEY = 'odd:data-view'

/** Docs: database.md woven into the schema. Schema: the tables alone, compact. Remembered per browser. */
function useDataView(): [DataView, (view: DataView) => void] {
  const [view, setView] = useState<DataView>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'schema' ? 'schema' : 'docs'
    } catch {
      return 'docs'
    }
  })
  const update = (next: DataView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // the choice just isn't remembered
    }
  }
  return [view, update]
}

/** Where an API or MCP table comes from, and the parameters it waits for. */
function TableOrigin({ origin }: { origin: { call: string; params: string[] } | undefined }) {
  const t = useT()
  if (!origin) return null
  return (
    <p className="odd-table-origin">
      <code>{origin.call}</code>
      {origin.params.length ? (
        <span>{t('needs {names}', { names: origin.params.map((p) => `:${p}`).join(', ') })}</span>
      ) : null}
    </p>
  )
}

function anchor(name: string): string {
  return `table-${name.replace(/[^A-Za-z0-9_-]/g, '-')}`
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
  const { locale } = useLocale()
  const [view, setView] = useDataView()
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

  const tables = useMemo(
    () =>
      schema?.tables.filter(
        (t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()),
      ) ?? [],
    [schema, filter],
  )
  const doc = useDatabaseDoc(current?.ok ? selected : undefined)
  const detail = useSourceDetail(
    current?.ok && isJsonSource(current.type) ? selected : undefined,
    sources,
  )
  // JSON has no NOT NULL: on an API or MCP source "nullable" would mark every column.
  const json = current ? isJsonSource(current.type) : false
  const origin = useMemo(() => {
    const out = new Map<string, { call: string; params: string[] }>()
    if (detail?.kind === 'http')
      for (const e of detail.endpoints) out.set(e.table, { call: `GET ${e.url}`, params: e.params })
    if (detail?.kind === 'mcp')
      for (const e of detail.tables) out.set(e.table, { call: e.tool, params: e.params })
    return out
  }, [detail])
  const ids = useMemo(
    () =>
      tables.map((table) => anchor(table.schema ? `${table.schema}.${table.name}` : table.name)),
    [tables],
  )
  const currentSection = useCurrentSection(ids)
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )
  const notes = useMemo(
    () => (doc?.markdown ? splitDatabaseDoc(doc.markdown).tables : undefined),
    [doc],
  )

  return (
    <div className="odd-page">
      <header className="odd-page-head odd-data-head">
        {current ? (
          <h1 className="odd-source-title">
            {current.name}
            <span>{driverFor(current.type)?.label ?? current.type}</span>
          </h1>
        ) : (
          <h1>{t('Data sources')}</h1>
        )}
        {schema ? (
          <fieldset className="odd-mode">
            <legend className="odd-sr-only">{t('Show as')}</legend>
            <button type="button" aria-pressed={view === 'docs'} onClick={() => setView('docs')}>
              <span>{t('Docs')}</span>
            </button>
            <button
              type="button"
              aria-pressed={view === 'schema'}
              onClick={() => setView('schema')}
            >
              <span>{t('Schema')}</span>
            </button>
          </fieldset>
        ) : null}
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
      {schema && view === 'schema' ? (
        <>
          <input
            className="odd-search"
            type="search"
            placeholder={t('Filter {n} tables', { n: schema.tables.length })}
            aria-label={t('Filter tables')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {detail ? <SourceOrigin detail={detail} tables={schema.tables} /> : null}
          <div className="odd-schema">
            {tables.map((table) => (
              <section
                key={`${table.schema ?? ''}.${table.name}`}
                id={anchor(table.schema ? `${table.schema}.${table.name}` : table.name)}
                className="odd-schema-table"
              >
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
                <TableOrigin origin={origin.get(table.name)} />
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
                              : column.nullable || json
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
      ) : schema ? (
        <div className="odd-db">
          <article className="odd-db-main">
            {detail ? <SourceOrigin detail={detail} tables={schema.tables} /> : null}
            {doc && selected ? <DatabaseIntro doc={doc} source={selected} /> : null}
            {tables.map((table) => {
              const qualified = table.schema ? `${table.schema}.${table.name}` : table.name
              const shown = table.schema && table.schema !== 'public' ? qualified : table.name
              const about =
                notes?.get(qualified.toLowerCase()) ?? notes?.get(table.name.toLowerCase())
              return (
                <section key={qualified} id={anchor(qualified)} className="odd-db-table">
                  <header>
                    <h2>{shown}</h2>
                    <span>
                      {table.rowCount !== undefined
                        ? t(table.kind === 'view' ? 'View, {n} rows' : '{n} rows', {
                            n: table.rowCount.toLocaleString(),
                          })
                        : t(table.kind === 'view' ? 'View' : 'Table')}
                    </span>
                  </header>
                  <TableOrigin origin={origin.get(table.name)} />
                  {about?.about.length ? (
                    <div className="odd-prose">
                      <Blocks blocks={about.about} />
                    </div>
                  ) : null}
                  <dl className="odd-db-columns">
                    {table.columns.map((column) => {
                      const fk = table.foreignKeys.find((f) => f.column === column.name)
                      const note = about?.columns.get(column.name.toLowerCase())
                      return (
                        <div key={column.name} className="odd-db-column">
                          <dt>
                            <code>{column.name}</code>
                          </dt>
                          <dd className="odd-db-type">
                            {column.type}
                            {column.primaryKey ? <span className="odd-badge">PK</span> : null}
                            {column.nullable && !json ? (
                              <span className="odd-db-nullable">{t('nullable')}</span>
                            ) : null}
                          </dd>
                          <dd className="odd-db-note">
                            {fk ? (
                              <a
                                className="odd-db-fk"
                                href={`#${anchor(fk.table)}`}
                              >{`→ ${fk.table}.${fk.references}`}</a>
                            ) : null}
                            {note ? <Inline text={note} /> : null}
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                </section>
              )
            })}
          </article>
          <nav className="odd-db-toc" aria-label={t('Tables')}>
            <input
              className="odd-search"
              type="search"
              placeholder={t('Filter {n} tables', { n: schema.tables.length })}
              aria-label={t('Filter tables')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <ul>
              {tables.map((table) => {
                const qualified = table.schema ? `${table.schema}.${table.name}` : table.name
                return (
                  <li key={qualified}>
                    <a
                      href={`#${anchor(qualified)}`}
                      aria-current={currentSection === anchor(qualified) ? 'location' : undefined}
                    >
                      <span>
                        {table.schema && table.schema !== 'public' ? qualified : table.name}
                      </span>
                      {table.rowCount !== undefined ? (
                        <span className="odd-db-count">{compact.format(table.rowCount)}</span>
                      ) : null}
                    </a>
                  </li>
                )
              })}
            </ul>
          </nav>
        </div>
      ) : !error && current?.ok ? (
        <p className="odd-muted">{t('Reading schema…')}</p>
      ) : null}
    </div>
  )
}
