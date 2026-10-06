import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DashboardSummary } from '../../ops/dashboards.js'
import type { ThemeSummary } from '../../ops/themes.js'
import { useT } from '../../runtime/i18n.js'
import {
  BUILT_IN,
  type ColorKey,
  type DashboardTheme,
  type Mode,
  SERIES_COUNT,
  type ThemeColors,
  validateTheme,
} from '../../runtime/theme.js'
import { MoonIcon, SunIcon } from '../components/icons.js'
import { api } from '../lib/api.js'
import { linkProps, navigate, setNavigationGuard } from '../lib/router.js'
import { useThemeFile, useThemeList } from '../lib/themes.js'
import { DashboardView } from './dashboard.js'

const HEX = /^#[0-9a-f]{6}$/i
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const PREVIEW_ID = '__preview'

const SURFACE_FIELDS: { key: ColorKey; label: string }[] = [
  { key: 'page', label: 'Page background' },
  { key: 'surface', label: 'Panel background' },
  { key: 'grid', label: 'Grid lines' },
]

const SIGNAL_FIELDS: { key: ColorKey; label: string }[] = [
  { key: 'accent', label: 'Accent' },
  { key: 'good', label: 'Up' },
  { key: 'bad', label: 'Down' },
]

const FONTS: { label: string; value: string | undefined }[] = [
  { label: 'System', value: undefined },
  { label: 'Noto Sans TC', value: '"Noto Sans TC", "PingFang TC", sans-serif' },
  { label: 'Noto Serif TC', value: '"Noto Serif TC", "Songti TC", Georgia, serif' },
  { label: 'Inter', value: 'Inter, "Helvetica Neue", Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
]

const MONOS: { label: string; value: string | undefined }[] = [
  { label: 'System', value: undefined },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
  { label: 'Menlo', value: 'Menlo, Consolas, monospace' },
]

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )
}

function expand(hex: string): string {
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
}

export function ThemesView({
  id,
  dashboards,
}: {
  id?: string
  dashboards: DashboardSummary[] | undefined
}) {
  const t = useT()
  const list = useThemeList()
  const selected = id ?? list?.themes[0]?.id

  useEffect(() => {
    if (!id && selected) navigate(`/themes/${encodeURIComponent(selected)}`, { replace: true })
  }, [id, selected])

  return (
    <div className="odd-page odd-studio-page">
      <header className="odd-studio-head">
        <h1>{t('Themes')}</h1>
        <div className="odd-studio-actions">
          {list?.themes.length ? (
            <ThemePicker themes={list.themes} selected={selected} isDefault={list.default} />
          ) : null}
          <NewTheme taken={new Set(list?.themes.map((theme) => theme.id))} />
        </div>
      </header>
      {selected ? (
        <ThemeEditor
          key={selected}
          id={selected}
          dashboards={dashboards ?? []}
          isDefault={list?.default === selected}
        />
      ) : list ? (
        <div className="odd-studio-empty">
          <p>{t('No themes yet')}</p>
        </div>
      ) : null}
    </div>
  )
}

function ThemePicker({
  themes,
  selected,
  isDefault,
}: {
  themes: ThemeSummary[]
  selected: string | undefined
  isDefault: string | undefined
}) {
  const t = useT()
  return (
    <label className="odd-studio-select">
      <span className="odd-sr-only">{t('Themes')}</span>
      <select
        value={selected ?? ''}
        onChange={(event) => navigate(`/themes/${encodeURIComponent(event.target.value)}`)}
      >
        {themes.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
            {isDefault === theme.id ? ` · ${t('Default')}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

function NewTheme({ taken }: { taken: Set<string> }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string>()
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const valid = ID.test(value) && !taken.has(value)

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!valid) return
    try {
      await api.saveTheme(value, '', { name: value })
      setValue('')
      setError(undefined)
      setOpen(false)
      navigate(`/themes/${encodeURIComponent(value)}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="odd-popover-anchor" ref={root}>
      <button
        type="button"
        className="odd-button odd-button-primary"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        + {t('New theme')}
      </button>
      {open ? (
        <form className="odd-popover" id={id} onSubmit={create}>
          <label className="odd-field">
            <span>{t('Theme id')}</span>
            <input
              ref={input}
              type="text"
              value={value}
              placeholder="brand"
              spellCheck={false}
              aria-invalid={value !== '' && !valid}
              onChange={(event) => setValue(event.target.value.trim())}
            />
          </label>
          {error ? <p className="odd-field-error">{error}</p> : null}
          <button type="submit" className="odd-button odd-button-primary" disabled={!valid}>
            {t('Create')}
          </button>
        </form>
      ) : null}
    </div>
  )
}

type Status =
  | { kind: 'idle' }
  | { kind: 'blocked' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; message: string }

/** While the editor is open, the app shows the mode being edited, so the preview is that mode. */
function useEditingMode(): [Mode, (mode: Mode) => void] {
  const [mode, setMode] = useState<Mode>(() =>
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light',
  )
  useEffect(() => {
    const root = document.documentElement
    const before = root.dataset.theme
    root.dataset.theme = mode
    return () => {
      if (before) root.dataset.theme = before
      else delete root.dataset.theme
    }
  }, [mode])
  return [mode, setMode]
}

function ThemeEditor({
  id,
  dashboards,
  isDefault,
}: {
  id: string
  dashboards: DashboardSummary[]
  isDefault: boolean
}) {
  const t = useT()
  const { file, error } = useThemeFile(id)
  const [draft, setDraft] = useState<DashboardTheme>()
  const [hash, setHash] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [mode, setMode] = useEditingMode()
  const usedBy = dashboards.filter((d) => d.theme === id || (isDefault && !d.theme))
  const [previewId, setPreviewId] = useState<string>()
  const preview = previewId ?? usedBy[0]?.id ?? dashboards[0]?.id

  const dirty = Boolean(file && draft && canonical(draft) !== canonical(file.theme))
  // A file that changed on disk replaces the editor's copy only while nothing is unsaved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dirty is read at the moment a new file arrives
  useEffect(() => {
    if (!file || dirty) return
    setDraft(file.theme)
    setHash(file.hash)
  }, [file])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    const release = setNavigationGuard(() => {
      setStatus({ kind: 'blocked' })
      return true
    })
    return () => {
      window.removeEventListener('beforeunload', warn)
      release()
    }
  }, [dirty])

  const previewTheme = useMemo(
    () => (draft ? { id: PREVIEW_ID, theme: draft } : undefined),
    [draft],
  )

  if (error) return <p className="odd-callout odd-callout-error">{error}</p>
  if (!draft || !file) return <p className="odd-muted">{t('Loading…')}</p>

  const colors: ThemeColors = draft[mode] ?? {}
  const builtIn = BUILT_IN[mode]
  const touch = () => setStatus({ kind: 'idle' })
  const setColors = (next: ThemeColors) => {
    const cleaned = Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== undefined),
    ) as ThemeColors
    const rest = { ...draft }
    delete rest[mode]
    setDraft(Object.keys(cleaned).length ? { ...rest, [mode]: cleaned } : rest)
    touch()
  }
  const setField = <K extends keyof DashboardTheme>(key: K, value: DashboardTheme[K]) => {
    const next = { ...draft }
    if (value === undefined || value === '') delete next[key]
    else next[key] = value
    setDraft(next)
    touch()
  }
  const series = colors.series ?? []
  const seriesAt = (i: number) => series[i] ?? (builtIn.series[i] as string)
  const setSeries = (index: number, value: string) => {
    const full = Array.from({ length: SERIES_COUNT }, (_, i) => seriesAt(i))
    full[index] = value
    const same = full.every((color, i) => color === builtIn.series[i])
    setColors({ ...colors, series: same ? undefined : full })
  }

  const save = async () => {
    try {
      validateTheme(draft)
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
      return
    }
    setStatus({ kind: 'saving' })
    try {
      const saved = await api.saveTheme(id, hash, draft)
      setHash(saved.hash)
      setStatus({ kind: 'saved' })
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
    }
  }

  return (
    <div className="odd-studio">
      <aside className="odd-studio-panel" aria-label={t('Themes')}>
        <section className="odd-studio-section">
          <label className="odd-field">
            <span>{t('Name')}</span>
            <input
              type="text"
              value={draft.name ?? ''}
              maxLength={80}
              placeholder={id}
              onChange={(event) => setField('name', event.target.value || undefined)}
            />
          </label>
          <fieldset className="odd-studio-mode">
            <legend className="odd-sr-only">{t('Theme')}</legend>
            <button type="button" aria-pressed={mode === 'light'} onClick={() => setMode('light')}>
              <SunIcon />
              {t('Light')}
            </button>
            <button type="button" aria-pressed={mode === 'dark'} onClick={() => setMode('dark')}>
              <MoonIcon />
              {t('Dark')}
            </button>
          </fieldset>
        </section>

        <section className="odd-studio-section">
          <div className="odd-studio-section-head">
            <h2>{t('Chart colours')}</h2>
            {colors.series ? (
              <button
                type="button"
                className="odd-text-button"
                onClick={() => setColors({ ...colors, series: undefined })}
              >
                {t('Reset')}
              </button>
            ) : null}
          </div>
          <div className="odd-palette">
            {Array.from({ length: SERIES_COUNT }, (_, i) => (
              <label
                // biome-ignore lint/suspicious/noArrayIndexKey: a series slot is its position
                key={i}
                className="odd-palette-chip"
                style={{ background: seriesAt(i) }}
                title={seriesAt(i)}
              >
                <input
                  type="color"
                  value={expand(seriesAt(i))}
                  aria-label={`${t('Chart colours')} ${i + 1}`}
                  onChange={(event) => setSeries(i, event.target.value)}
                />
                <span aria-hidden="true">{i + 1}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="odd-studio-section">
          <h2>{t('Signals')}</h2>
          {SIGNAL_FIELDS.map(({ key, label }) => (
            <ColorRow
              key={key}
              label={t(label)}
              value={colors[key]}
              fallback={builtIn[key] as string}
              onChange={(value) => setColors({ ...colors, [key]: value })}
            />
          ))}
        </section>

        <section className="odd-studio-section">
          <h2>{t('Surfaces')}</h2>
          {SURFACE_FIELDS.map(({ key, label }) => (
            <ColorRow
              key={key}
              label={t(label)}
              value={colors[key]}
              fallback={builtIn[key] as string}
              onChange={(value) => setColors({ ...colors, [key]: value })}
            />
          ))}
        </section>

        <section className="odd-studio-section">
          <h2>{t('Type and shape')}</h2>
          <FontSelect
            label={t('Font')}
            options={FONTS}
            value={draft.font}
            onChange={(value) => setField('font', value)}
          />
          <FontSelect
            label={t('Monospace font')}
            options={MONOS}
            value={draft.mono}
            onChange={(value) => setField('mono', value)}
          />
          <label className="odd-field">
            <span>
              {t('Corner radius')}
              <em className="odd-field-note">{draft.radius ?? BUILT_IN.radius}px</em>
            </span>
            <input
              type="range"
              className="odd-range"
              min={0}
              max={24}
              value={draft.radius ?? BUILT_IN.radius}
              onChange={(event) => {
                const value = Number(event.target.value)
                setField('radius', value === BUILT_IN.radius ? undefined : value)
              }}
            />
          </label>
        </section>

        <footer className="odd-studio-foot">
          <code>{file.file}</code>
          {usedBy.length ? (
            <div className="odd-chips">
              {usedBy.map((d) => (
                <a key={d.id} {...linkProps(`/d/${encodeURIComponent(d.id)}`)}>
                  {d.title}
                </a>
              ))}
            </div>
          ) : null}
        </footer>
      </aside>

      <section className="odd-studio-preview" aria-label={t('Preview')}>
        <div className="odd-studio-preview-bar">
          <span className="odd-studio-preview-label">{t('Preview')}</span>
          <label className="odd-studio-select">
            <span className="odd-sr-only">{t('Preview')}</span>
            <select value={preview ?? ''} onChange={(event) => setPreviewId(event.target.value)}>
              {dashboards.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="odd-studio-canvas">
          {preview && previewTheme ? (
            <DashboardView key={preview} id={preview} preview={previewTheme} />
          ) : null}
        </div>
      </section>

      {dirty || status.kind !== 'idle' ? (
        <div
          className="odd-savebar"
          role="status"
          data-status={status.kind}
          data-dirty={dirty || undefined}
        >
          <span className="odd-savebar-message">
            {status.kind === 'saving'
              ? t('Saving…')
              : status.kind === 'blocked'
                ? t('Save or discard your changes first.')
                : status.kind === 'error'
                  ? status.message
                  : status.kind === 'saved' && !dirty
                    ? t('Saved to {file}', { file: file.file })
                    : t('Unsaved changes')}
          </span>
          {dirty && status.kind !== 'saving' ? (
            <>
              <button
                type="button"
                className="odd-button odd-button-ghost"
                onClick={() => {
                  setDraft(file.theme)
                  touch()
                }}
              >
                {t('Discard')}
              </button>
              <button type="button" className="odd-button odd-button-primary" onClick={save}>
                {t('Save')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string
  value: string | undefined
  fallback: string
  onChange: (value: string | undefined) => void
}) {
  const t = useT()
  const shown = expand(value ?? fallback)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  return (
    <div className="odd-color-row" data-set={value ? '' : undefined}>
      <span className="odd-color-label">{label}</span>
      <span className="odd-color-control">
        <label className="odd-color-swatch" style={{ background: shown }}>
          <input
            type="color"
            value={shown}
            aria-label={label}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        <input
          type="text"
          className="odd-color-hex"
          value={text}
          spellCheck={false}
          aria-label={label}
          onChange={(event) => {
            setText(event.target.value)
            if (HEX.test(event.target.value)) onChange(event.target.value.toLowerCase())
          }}
        />
        <button
          type="button"
          className="odd-icon-button odd-color-reset"
          title={t('Reset')}
          aria-label={t('Reset')}
          disabled={!value}
          onClick={() => onChange(undefined)}
        >
          ↺
        </button>
      </span>
    </div>
  )
}

function FontSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { label: string; value: string | undefined }[]
  value: string | undefined
  onChange: (value: string | undefined) => void
}) {
  const t = useT()
  const known = options.some((option) => option.value === value)
  const [custom, setCustom] = useState(!known)
  return (
    <div className="odd-field">
      <span>{label}</span>
      <select
        value={custom ? '__custom' : (value ?? '')}
        onChange={(event) => {
          if (event.target.value === '__custom') {
            setCustom(true)
            return
          }
          setCustom(false)
          onChange(event.target.value || undefined)
        }}
      >
        {options.map((option) => (
          <option key={option.label} value={option.value ?? ''}>
            {option.value ? option.label : t('System')}
          </option>
        ))}
        <option value="__custom">{t('Custom…')}</option>
      </select>
      {custom ? (
        <input
          type="text"
          value={value ?? ''}
          placeholder='"Noto Sans TC", sans-serif'
          spellCheck={false}
          aria-label={label}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      ) : null}
    </div>
  )
}
