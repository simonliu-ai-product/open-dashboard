// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ParamValue } from '../config.js'
import { HostContext, type HostContextValue } from '../runtime/context.js'
import type { QueryRun } from '../runtime/types.js'
import { Select, TimeRange } from './filters.js'
import { Dashboard, Filters, Row } from './layout.js'
import { Stat } from './stat.js'
import { Table } from './table.js'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

function runOf(name: string, rows: Record<string, unknown>[]): QueryRun {
  const columns = Object.keys(rows[0] ?? {}).map((key) => ({
    name: key,
    type: typeof rows[0]?.[key] === 'number' ? ('number' as const) : ('string' as const),
  }))
  return {
    query: { name, source: 'db', sql: 'SELECT 1', file: 'q.sql', line: 1 },
    params: {},
    result: { columns, rows, truncated: false, elapsedMs: 1 },
  }
}

function host(calls: [string, Record<string, ParamValue>][]): HostContextValue {
  return {
    id: 'test',
    meta: { title: 'Test dashboard' },
    tick: 0,
    refresh: () => {},
    inspect: () => {},
    onParams: () => {},
    fetchQuery: async (name, params) => {
      calls.push([name, params])
      if (name === 'regions') return runOf(name, [{ region: 'North' }, { region: 'South' }])
      if (name === 'orders') return runOf(name, [{ id: 7, total: 12.5 }])
      return runOf(name, [{ revenue: 1200, revenue_prev: 1000 }])
    },
  }
}

function view() {
  return (
    <Dashboard>
      <Filters>
        <TimeRange default="7d" />
        <Select name="region" query="regions" />
      </Filters>
      <Row>
        <Stat
          title="Revenue"
          query="kpis"
          column="revenue"
          compare="revenue_prev"
          format="currency"
        />
      </Row>
      <Table title="Orders" query="orders" />
    </Dashboard>
  )
}

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('<Dashboard>', () => {
  it('sends the filter defaults with the very first query', async () => {
    const calls: [string, Record<string, ParamValue>][] = []
    await act(async () => {
      render(<HostContext.Provider value={host(calls)}>{view()}</HostContext.Provider>)
    })
    const first = calls.find(([name]) => name === 'kpis')
    expect(first?.[1]).toMatchObject({ region: null })
    expect(typeof first?.[1].from).toBe('string')
    expect(calls.filter(([name]) => name === 'kpis')).toHaveLength(1)
  })

  it('reads filter values from the URL and writes changes back', async () => {
    window.history.replaceState(null, '', '/d/test?region=South')
    const calls: [string, Record<string, ParamValue>][] = []
    await act(async () => {
      render(<HostContext.Provider value={host(calls)}>{view()}</HostContext.Provider>)
    })
    expect(calls.find(([name]) => name === 'kpis')?.[1].region).toBe('South')

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Region'), { target: { value: '' } })
    })
    expect(calls.at(-1)?.[1].region).toBeNull()
    expect(window.location.search).toBe('')
  })

  it('renders a stat with its change against the comparison column', async () => {
    await act(async () => {
      render(<HostContext.Provider value={host([])}>{view()}</HostContext.Provider>)
    })
    expect(screen.getByText('$1,200')).toBeTruthy()
    expect(screen.getByText('20%')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Test dashboard' })).toBeTruthy()
  })

  it('does not group an id column in a table', async () => {
    await act(async () => {
      render(<HostContext.Provider value={host([])}>{view()}</HostContext.Provider>)
    })
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('12.5')).toBeTruthy()
  })
})
