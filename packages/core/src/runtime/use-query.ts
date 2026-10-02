import { useEffect, useRef, useState } from 'react'
import { useFilters, useHost } from './context.js'
import type { QueryRun } from './types.js'

export interface QueryState {
  status: 'idle' | 'loading' | 'ok' | 'error'
  run?: QueryRun
  error?: string
  /** True while a refetch runs behind data that is still on screen. */
  refreshing: boolean
}

/**
 * Keeps the last result on screen while a new one loads, so changing a filter
 * dims a chart instead of blanking the whole dashboard.
 */
export function useQuery(name: string | undefined): QueryState {
  const host = useHost()
  const { params } = useFilters()
  const key = JSON.stringify(params)
  const [state, setState] = useState<QueryState>({
    status: name ? 'loading' : 'idle',
    refreshing: false,
  })
  const latest = useRef(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: params is captured through key
  useEffect(() => {
    if (!name) {
      setState({ status: 'idle', refreshing: false })
      return
    }
    const request = ++latest.current
    setState((previous) =>
      previous.run ? { ...previous, refreshing: true } : { status: 'loading', refreshing: false },
    )
    host.fetchQuery(name, params).then(
      (run) => {
        if (request === latest.current) setState({ status: 'ok', run, refreshing: false })
      },
      (error: unknown) => {
        if (request !== latest.current) return
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          refreshing: false,
        })
      },
    )
  }, [name, key, host.tick, host.id])

  return state
}
