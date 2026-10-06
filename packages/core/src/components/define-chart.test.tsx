// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { HostContext, type HostContextValue } from '../runtime/context.js'
import { exportName, panelToSvg } from '../runtime/export-panel.js'
import type { QueryRun } from '../runtime/types.js'
import { defineChart } from './define-chart.js'

globalThis.ResizeObserver = class {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [{ contentRect: { width: 400, height: 200 } } as ResizeObserverEntry],
      this as never,
    )
  }
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const ROWS = [
  { axis: 'North', value: 3 },
  { axis: 'South', value: 5 },
]

function host(inspectable = true): HostContextValue {
  const run: QueryRun = {
    query: { name: 'q', source: 'db', sql: 'SELECT 1', file: 'q.sql', line: 1 },
    params: {},
    result: {
      columns: [
        { name: 'axis', type: 'string' },
        { name: 'value', type: 'number' },
      ],
      rows: ROWS,
      truncated: false,
      elapsedMs: 1,
    },
  }
  return {
    id: 'test',
    meta: { title: 'Test', locale: 'en-US' },
    tick: 0,
    refresh: () => {},
    inspect: () => {},
    inspectable,
    onParams: () => {},
    fetchQuery: async () => run,
  }
}

async function draw(element: ReactElement, value = host()) {
  let container!: HTMLElement
  await act(async () => {
    container = render(
      <HostContext.Provider value={value}>{element}</HostContext.Provider>,
    ).container
  })
  await act(async () => {})
  return container
}

afterEach(() => cleanup())

// jsdom does no layout: give text a box so it can be placed, and no canvas.
Range.prototype.getClientRects = () =>
  [{ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10 }] as never
HTMLCanvasElement.prototype.getContext = (() => null) as never
Element.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, x: 0, y: 0, width: 400, height: 200, right: 400, bottom: 200 }) as never

const Bars = defineChart<{ axis: string; value: string }>({
  name: 'Bars',
  columns: ['axis', 'value'],
  render: ({ rows, props, width, height, color, format }) => (
    <svg width={width} height={height} role="img" aria-label={props.title}>
      {rows.map((row, i) => (
        <rect
          key={String(row[props.axis])}
          data-label={String(row[props.axis])}
          fill={color(i)}
          width={Number(row[props.value]) * 10}
          height={10}
        >
          <title>{format(row[props.value], 'integer')}</title>
        </rect>
      ))}
    </svg>
  ),
})

describe('defineChart', () => {
  it('draws inside the panel frame, sized, themed and formatted', async () => {
    const container = await draw(<Bars title="By region" query="q" axis="axis" value="value" />)
    expect(container.querySelector('.odd-panel h3')?.textContent).toBe('By region')
    expect(container.querySelector('.odd-custom-plot svg')?.getAttribute('width')).toBe('400')
    const bars = [...container.querySelectorAll('rect[data-label]')]
    expect(bars.map((bar) => bar.getAttribute('fill'))).toEqual([
      'var(--odd-series-1)',
      'var(--odd-series-2)',
    ])
    expect(bars[1]?.querySelector('title')?.textContent).toBe('5')
    expect(container.querySelector('.odd-download')).not.toBeNull()
  })

  it('keeps a chart that throws inside its own panel', async () => {
    const Broken = defineChart({
      name: 'Broken',
      render: () => {
        throw new Error('no spokes')
      },
    })
    const original = console.error
    console.error = () => {}
    try {
      const container = await draw(<Broken title="Oops" query="q" />)
      expect(container.querySelector('.odd-panel-error')?.textContent).toContain('no spokes')
      expect(container.querySelector('.odd-panel h3')?.textContent).toBe('Oops')
    } finally {
      console.error = original
    }
  })

  it('shows no Inspect button where there is no inspector', async () => {
    const withInspector = await draw(<Bars title="A" query="q" axis="axis" value="value" />)
    const count = withInspector.querySelectorAll('.odd-panel-actions > button').length
    cleanup()
    const preview = await draw(<Bars title="A" query="q" axis="axis" value="value" />, host(false))
    expect(preview.querySelectorAll('.odd-panel-actions > button').length).toBe(count - 1)
  })
})

describe('panel export', () => {
  it('names the file after the dashboard and the title', () => {
    expect(exportName('sales', 'Revenue by month')).toBe('sales-Revenue-by-month')
    expect(exportName('sales', '各區營收：本期 / 上一期')).toBe('sales-各區營收-本期-上一期')
  })

  it('leaves the buttons out and keeps the title and the chart', async () => {
    const container = await draw(<Bars title="By region" query="q" axis="axis" value="value" />)
    const panel = container.querySelector('.odd-panel') as HTMLElement
    const { svg } = panelToSvg(panel)
    expect(svg).toContain('<rect data-label="North"')
    expect(svg).not.toContain('odd-download')
    expect(svg).not.toContain('odd-icon-button')
    expect(svg).not.toContain('var(--odd-')
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  })
})
