import {
  type Context,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { JA } from './i18n-ja/index.js'
import { KO } from './i18n-ko/index.js'
import { ZH_CN } from './i18n-zh-cn/index.js'
import { ZH_TW } from './i18n-zh-tw/index.js'

/**
 * The viewer chrome in the same five languages as open-doc. The English text is
 * the key, so a string with no translation yet still reads — in English —
 * instead of showing a key. Only the chrome is translated: titles, panel names
 * and numbers belong to the dashboard.
 */
export const LOCALES = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
] as const
export type Locale = (typeof LOCALES)[number]['value']

const STORAGE = 'odd:locale'
export const DICTIONARIES: Record<Locale, Record<string, string>> = {
  en: {},
  'zh-TW': ZH_TW,
  'zh-CN': ZH_CN,
  ja: JA,
  ko: KO,
}

const isLocale = (value: string | null): value is Locale =>
  LOCALES.some((entry) => entry.value === value)

/** The reader's browser language, mapped onto a locale we have; Chinese splits by script. */
export function browserLocale(language: string): Locale {
  if (/^zh-(TW|HK|MO)\b|^zh-Hant/i.test(language)) return 'zh-TW'
  if (/^zh/i.test(language)) return 'zh-CN'
  if (/^ja/i.test(language)) return 'ja'
  if (/^ko/i.test(language)) return 'ko'
  return 'en'
}

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE)
    if (isLocale(stored)) return stored
  } catch {
    // storage can be unavailable; fall back to the browser's language
  }
  return typeof navigator === 'undefined' ? 'en' : browserLocale(navigator.language)
}

export type Translate = (text: string, vars?: Record<string, string | number>) => string

export function translate(
  locale: Locale,
  text: string,
  vars?: Record<string, string | number>,
): string {
  const template = DICTIONARIES[locale][text] ?? text
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  )
}

interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

const store = globalThis as typeof globalThis & { __openDashboardLocale?: Context<LocaleState> }
store.__openDashboardLocale ??= createContext<LocaleState>({
  locale: 'en',
  setLocale: () => {},
  t: (text, vars) => translate('en', text, vars),
})
const LocaleContext = store.__openDashboardLocale

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(STORAGE, next)
    } catch {
      // the choice still applies for this visit
    }
  }, [])

  // `t` keeps one identity and reads the locale when called: components still
  // re-render on a switch, but an effect that lists `t` does not re-run, so a
  // language change never refetches what a panel or the inspector holds.
  const localeRef = useRef(locale)
  localeRef.current = locale
  const t = useCallback<Translate>((text, vars) => translate(localeRef.current, text, vars), [])
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleState {
  return useContext(LocaleContext)
}

export function useT(): Translate {
  return useContext(LocaleContext).t
}
