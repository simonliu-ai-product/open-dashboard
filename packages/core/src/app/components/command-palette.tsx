import { useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardSummary } from '../../ops/dashboards.js'
import type { SourceStatus } from '../../ops/sources.js'
import { useT } from '../../runtime/i18n.js'
import { navigate } from '../lib/router.js'
import type { Theme } from '../lib/theme.js'

interface CommandItem {
  id: string
  group: string
  label: string
  detail?: string
  run: () => void
}

export function CommandPalette(props: {
  open: boolean
  onClose: () => void
  dashboards: DashboardSummary[] | undefined
  sources: SourceStatus[] | undefined
  live: boolean
  isDashboard: boolean
  kiosk: boolean
  theme: Theme
  onTheme: (next: Theme) => void
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!props.open) return
    setQuery('')
    setActiveIdx(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [props.open])

  const items = useMemo<CommandItem[]>(() => {
    if (!props.open) return []
    const list: CommandItem[] = []

    if (props.isDashboard && typeof document !== 'undefined') {
      const viewButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.odd-saved-view'),
      )
      for (const btn of viewButtons) {
        const name = btn.textContent?.trim()
        if (!name) continue
        list.push({
          id: `view:${name}`,
          group: t('View'),
          label: name,
          run: () => btn.click(),
        })
      }

      const panelNodes = Array.from(document.querySelectorAll<HTMLElement>('[data-panel-title]'))
      for (const node of panelNodes) {
        const title = node.getAttribute('data-panel-title')
        if (!title) continue
        list.push({
          id: `panel:${title}`,
          group: t('Panels'),
          label: title,
          run: () => {
            node.scrollIntoView({ behavior: 'smooth', block: 'center' })
            node.setAttribute('data-flash', '')
            setTimeout(() => node.removeAttribute('data-flash'), 1400)
          },
        })
      }
    }

    for (const d of props.dashboards ?? []) {
      list.push({
        id: `dash:${d.id}`,
        group: t('Dashboards'),
        label: d.title,
        detail: d.description ?? d.id,
        run: () => navigate(`/d/${encodeURIComponent(d.id)}`),
      })
    }

    if (props.live) {
      for (const s of props.sources ?? []) {
        list.push({
          id: `source:${s.name}`,
          group: t('Data sources'),
          label: s.name,
          detail: s.type,
          run: () => navigate(`/data/${encodeURIComponent(s.name)}`),
        })
      }
    }

    if (props.isDashboard) {
      list.push({
        id: 'action:kiosk',
        group: t('Settings'),
        label: props.kiosk ? t('Exit kiosk') : t('Kiosk mode'),
        run: () => {
          const url = new URL(window.location.href)
          if (props.kiosk) url.searchParams.delete('kiosk')
          else url.searchParams.set('kiosk', '1')
          window.history.replaceState(window.history.state, '', url)
          window.dispatchEvent(new CustomEvent('odd:kiosk-changed'))
        },
      })
    }

    const nextTheme: Theme =
      props.theme === 'dark' ? 'light' : props.theme === 'light' ? 'system' : 'dark'
    list.push({
      id: 'action:theme',
      group: t('Settings'),
      label: `${t('Theme')}: ${nextTheme === 'dark' ? t('Dark') : nextTheme === 'light' ? t('Light') : t('Auto')}`,
      run: () => props.onTheme(nextTheme),
    })

    list.push({
      id: 'nav:home',
      group: t('Main'),
      label: t('Overview'),
      run: () => navigate('/'),
    })
    if (props.live) {
      list.push({
        id: 'nav:charts',
        group: t('Main'),
        label: t('Charts'),
        run: () => navigate('/charts'),
      })
      list.push({
        id: 'nav:themes',
        group: t('Main'),
        label: t('Themes'),
        run: () => navigate('/themes'),
      })
      list.push({
        id: 'nav:changes',
        group: t('Main'),
        label: t('Changes'),
        run: () => navigate('/changes'),
      })
    }

    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q) ||
        (item.detail?.toLowerCase().includes(q) ?? false),
    )
  }, [
    props.open,
    props.dashboards,
    props.sources,
    props.live,
    props.isDashboard,
    props.kiosk,
    props.theme,
    props.onTheme,
    query,
    t,
  ])

  const safeIdx = items.length === 0 ? 0 : Math.min(activeIdx, items.length - 1)

  if (!props.open) return null

  return (
    <div
      className="odd-cmdk-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('Search')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div className="odd-cmdk">
        <div className="odd-cmdk-head">
          <input
            ref={inputRef}
            type="search"
            className="odd-cmdk-input"
            value={query}
            placeholder={`${t('Search')}…`}
            aria-label={t('Search')}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIdx(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                props.onClose()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIdx((i) => (items.length === 0 ? 0 : (i + 1) % items.length))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIdx((i) =>
                  items.length === 0 ? 0 : (i - 1 + items.length) % items.length,
                )
              } else if (e.key === 'Enter' && items[safeIdx]) {
                e.preventDefault()
                const target = items[safeIdx]
                props.onClose()
                target.run()
              }
            }}
          />
          <kbd className="odd-cmdk-kbd">ESC</kbd>
        </div>
        <div className="odd-cmdk-list" role="listbox">
          {items.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={idx === safeIdx}
              className="odd-cmdk-item"
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => {
                props.onClose()
                item.run()
              }}
            >
              <span className="odd-cmdk-group">{item.group}</span>
              <span className="odd-cmdk-label">{item.label}</span>
              {item.detail ? <span className="odd-cmdk-detail">{item.detail}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
