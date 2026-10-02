import { useEffect, useId, useRef, useState } from 'react'
import { LOCALES, type Locale, useLocale } from '../../runtime/i18n.js'
import type { Theme } from '../lib/theme.js'
import { AutoIcon, CheckIcon, ChevronIcon, GlobeIcon, MoonIcon, SunIcon } from './icons.js'

const THEMES: { value: Theme; label: string; Icon: () => React.JSX.Element }[] = [
  { value: 'system', label: 'Auto', Icon: AutoIcon },
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
]

/**
 * Opens upward from the foot of the sidebar: the trigger sits at the bottom of
 * the viewport, so a menu dropping down would open off-screen.
 */
export function SettingsMenu({
  theme,
  onTheme,
}: {
  theme: Theme
  onTheme: (theme: Theme) => void
}) {
  const { locale, setLocale, t } = useLocale()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = LOCALES.find((entry) => entry.value === locale)
  const ThemeIcon = THEMES.find((entry) => entry.value === theme)?.Icon ?? AutoIcon

  return (
    <div className="odd-settings" ref={root}>
      {open ? (
        <div className="odd-settings-panel" id={id}>
          <fieldset className="odd-settings-group">
            <legend>{t('Theme')}</legend>
            <div className="odd-segmented">
              {THEMES.map(({ value, label, Icon }) => (
                <label key={value} className="odd-segment">
                  <input
                    type="radio"
                    name={`${id}-theme`}
                    value={value}
                    checked={theme === value}
                    onChange={() => onTheme(value)}
                  />
                  <Icon />
                  <span>{t(label)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="odd-settings-group">
            <legend>{t('Language')}</legend>
            <div className="odd-options">
              {LOCALES.map(({ value, label }) => (
                <label key={value} className="odd-option" lang={value}>
                  <input
                    type="radio"
                    name={`${id}-locale`}
                    value={value}
                    checked={locale === value}
                    onChange={() => setLocale(value as Locale)}
                  />
                  <span>{label}</span>
                  <CheckIcon />
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
      <button
        ref={trigger}
        type="button"
        className="odd-settings-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        <ThemeIcon />
        <span className="odd-settings-label">{t('Settings')}</span>
        <span className="odd-settings-current">
          <GlobeIcon />
          {current?.label}
        </span>
        <ChevronIcon />
      </button>
    </div>
  )
}
