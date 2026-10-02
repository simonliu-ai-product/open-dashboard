import { applyProps, convertProps } from './convert.js'

describe('convertProps', () => {
  const bar = {
    title: 'Revenue',
    query: 'q',
    x: 'month',
    y: ['revenue', 'cost'],
    series: undefined,
    horizontal: true,
    stacked: true,
    format: 'currency',
    span: 6,
  }

  it('keeps shared props between XY charts and drops what the target lacks', () => {
    expect(convertProps('BarChart', 'LineChart', bar)).toEqual({ horizontal: null })
    expect(
      convertProps('LineChart', 'AreaChart', { ...bar, horizontal: undefined, area: true }),
    ).toEqual({
      area: null,
      horizontal: null,
    })
  })

  it('carries the measure and category across shapes', () => {
    expect(convertProps('BarChart', 'PieChart', bar)).toEqual({
      label: 'month',
      value: 'revenue',
      x: null,
      y: null,
      series: null,
      horizontal: null,
      stacked: null,
    })
    expect(
      convertProps('PieChart', 'BarChart', { title: 't', query: 'q', label: 'region', value: 'n' }),
    ).toEqual({
      x: 'region',
      y: 'n',
      label: null,
      value: null,
    })
    expect(
      convertProps('Stat', 'LineChart', { title: 't', query: 'q', column: 'n', compare: 'p' }),
    ).toEqual({
      y: 'n',
      column: null,
      compare: null,
    })
    expect(convertProps('LineChart', 'Stat', { title: 't', query: 'q', x: 'day', y: 'n' })).toEqual(
      {
        column: 'n',
        x: null,
        y: null,
      },
    )
  })

  it('drops a named format when becoming a table, whose format is per column', () => {
    expect(convertProps('BarChart', 'Table', bar)).toMatchObject({ format: null, x: null, y: null })
  })

  it('applies changes, null removing', () => {
    expect(applyProps({ a: 1, b: 2 }, { b: null, c: 3 })).toEqual({ a: 1, c: 3 })
  })

  it('maps between the new shapes', () => {
    const long = { title: 't', query: 'q', x: 'month', y: 'revenue', series: 'channel' }
    expect(convertProps('BarChart', 'Heatmap', long)).toEqual({
      y: 'channel',
      value: 'revenue',
      series: null,
    })
    expect(
      convertProps('Heatmap', 'LineChart', {
        title: 't',
        query: 'q',
        x: 'hour',
        y: 'weekday',
        value: 'orders',
      }),
    ).toEqual({
      y: 'orders',
      series: 'weekday',
      value: null,
    })
    expect(
      convertProps('PieChart', 'Treemap', {
        title: 't',
        query: 'q',
        label: 'p',
        value: 'n',
        maxSlices: 6,
      }),
    ).toEqual({
      maxSlices: null,
    })
    expect(
      convertProps('Stat', 'Gauge', { title: 't', query: 'q', column: 'n', compare: 'p' }),
    ).toEqual({ compare: null })
    expect(
      convertProps('BarChart', 'FunnelChart', { title: 't', query: 'q', x: 'stage', y: 'n' }),
    ).toEqual({
      label: 'stage',
      value: 'n',
      x: null,
      y: null,
    })
  })
})
