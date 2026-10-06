import { useEffect, useState } from 'react'
import type { ThemeFile, ThemeList } from '../../ops/themes.js'
import { type DashboardTheme, themeCss } from '../../runtime/theme.js'
import { api } from './api.js'

function onThemesChanged(handler: (id?: string) => void): () => void {
  const listener = (data: unknown) => handler((data as { id?: string } | undefined)?.id)
  import.meta.hot?.on('odd:themes-changed', listener)
  import.meta.hot?.on('odd:queries-changed', listener)
  return () => {
    import.meta.hot?.off?.('odd:themes-changed', listener)
    import.meta.hot?.off?.('odd:queries-changed', listener)
  }
}

/** Every theme in the workspace, and the config's default. Reloads when a theme file or the config changes. */
export function useThemeList(): ThemeList | undefined {
  const [list, setList] = useState<ThemeList>()
  useEffect(() => {
    let live = true
    const load = () =>
      api.themes().then(
        (found) => live && setList(found),
        () => live && setList({ themes: [] }),
      )
    load()
    const off = onThemesChanged(() => load())
    return () => {
      live = false
      off()
    }
  }, [])
  return list
}

export function useThemeFile(id: string | undefined): {
  file?: ThemeFile
  error?: string
  reload: () => void
} {
  const [state, setState] = useState<{ file?: ThemeFile; error?: string }>({})
  const [version, setVersion] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: version re-reads the same id
  useEffect(() => {
    if (!id) {
      setState({})
      return
    }
    let live = true
    api.theme(id).then(
      (file) => live && setState({ file }),
      (error: Error) => live && setState({ error: error.message }),
    )
    const off = onThemesChanged((changed) => {
      if (!changed || changed === id) setVersion((v) => v + 1)
    })
    return () => {
      live = false
      off()
    }
  }, [id, version])
  return { ...state, reload: () => setVersion((v) => v + 1) }
}

export function ThemeStyle({ id, theme }: { id: string; theme: DashboardTheme }) {
  return <style>{themeCss(id, theme)}</style>
}
