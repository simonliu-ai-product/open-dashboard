// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { HostContext, type HostContextValue } from '../runtime/context.js'
import type { QueryRun } from '../runtime/types.js'
import { BulletChart } from './bullet-chart.js'
import { BumpChart } from './bump-chart.js'
import { DivergingBar } from './diverging-bar.js'
import { DotPlot } from './dot-plot.js'
import { Dumbbell } from './dumbbell.js'
import { Marimekko } from './marimekko.js'
import { SlopeChart } from './slope-chart.js'

globalThis.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 640, height: 320 } } as ResizeObserverEntry],
      this as never,
    )
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const ROWS = [
  {
    region: 'North',
    channel: 'web',
    month: '2026-01',
    last: 100,
    now: 130,
    target: 120,
    delta: 30,
  },
  { region: 'North', channel: 'app', month: '2026-02', last: 90, now: 80, target: 120, delta: -10 },
  { region: 'South', channel: 'web', month: '2026-01', last: 60, now: 75, target: 70, delta: 15 },
  { region: 'South', channel: 'app', month: '2026-02', last: 70, now: 50, target: 70, delta: -20 },
]

function host(): HostContextValue {
  const columns = Object.keys(ROWS[0] as object).map((name) => ({
    name,
    type:
      typeof (ROWS[0] as Record<string, unknown>)[name] === 'number'
        ? ('number' as const)
        : ('string' as const),
  }))
  const run: QueryRun = {
    query: { name: 'q', source: 'db', sql: 'SELECT 1', file: 'q.sql', line: 1 },
    params: {},
    result: { columns, rows: ROWS, truncated: false, elapsedMs: 1 },
  }
  return {
    id: 'test',
    meta: { title: 'Test' },
    tick: 0,
    refresh: () => {},
    inspect: () => {},
    onParams: () => {},
    fetchQuery: async () => run,
  }
}

async function draw(element: ReactElement) {
  let container!: HTMLElement
  await act(async () => {
    container = render(
      <HostContext.Provider value={host()}>{element}</HostContext.Provider>,
    ).container
  })
  return container
}

afterEach(cleanup)

describe('batch A charts draw', () => {
  it.each([
    ['DotPlot', <DotPlot key="a" title="t" query="q" label="region" value={['last', 'now']} />],
    ['Dumbbell', <Dumbbell key="b" title="t" query="q" label="region" from="last" to="now" />],
    [
      'BulletChart',
      <BulletChart
        key="c"
        title="t"
        query="q"
        label="region"
        value="now"
        target="target"
        bands={[50, 100]}
      />,
    ],
    ['DivergingBar', <DivergingBar key="d" title="t" query="q" label="channel" value="delta" />],
    [
      'Marimekko',
      <Marimekko key="e" title="t" query="q" x="region" series="channel" value="now" />,
    ],
    ['SlopeChart', <SlopeChart key="f" title="t" query="q" label="channel" from="last" to="now" />],
    ['BumpChart', <BumpChart key="g" title="t" query="q" x="month" series="region" value="now" />],
  ])('%s renders marks without errors', async (_name, element) => {
    const container = await draw(element)
    expect(container.querySelector('.odd-panel-message')).toBeNull()
    expect(container.querySelectorAll('svg circle, svg rect, svg path').length).toBeGreaterThan(2)
  })

  it('explains a missing column instead of drawing', async () => {
    const container = await draw(<Dumbbell title="t" query="q" from="nope" to="now" />)
    expect(container.querySelector('.odd-panel-message')?.textContent).toMatch(/from and to/)
  })
})
