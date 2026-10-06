import { describe, expect, it } from 'vitest'
import { inkOnColor, themeCss, validateTheme } from './theme.js'

describe('validateTheme', () => {
  it('keeps what is valid and lower-cases colours', () => {
    expect(
      validateTheme({
        name: 'Brand',
        radius: 4,
        font: '"Noto Sans TC", sans-serif',
        light: { series: ['#AA0000', '#00aa00'], accent: '#123456', good: '#c00' },
      }),
    ).toEqual({
      name: 'Brand',
      radius: 4,
      font: '"Noto Sans TC", sans-serif',
      light: { series: ['#aa0000', '#00aa00'], accent: '#123456', good: '#c00' },
    })
  })

  it('names the first field that is wrong', () => {
    expect(() => validateTheme({ light: { accent: 'red' } })).toThrow(/light.accent/)
    expect(() => validateTheme({ dark: { series: new Array(9).fill('#000000') } })).toThrow(
      /dark.series/,
    )
    expect(() => validateTheme({ radius: 99 })).toThrow(/radius/)
    expect(() => validateTheme({ font: 'x;} body{display:none' })).toThrow(/font/)
    expect(validateTheme({ font: '"微軟正黑體", "Noto Sans TC", sans-serif' }).font).toBe(
      '"微軟正黑體", "Noto Sans TC", sans-serif',
    )
    expect(() => validateTheme({ font: '"微軟正黑體"; color: red' })).toThrow(/font/)
    expect(() => validateTheme({ colour: '#000' })).toThrow(/unknown theme field/)
    expect(() => validateTheme({ light: { ink: '#000000' } })).toThrow(/unknown colour/)
  })
})

describe('themeCss', () => {
  it('scopes each mode to the selectors the stylesheet uses', () => {
    const css = themeCss('brand', {
      radius: 4,
      light: { series: ['#ffee00'], page: '#ffffff' },
      dark: { bad: '#ff0000' },
    })
    expect(css).toContain('[data-odd-theme="brand"]{--odd-radius:4px}')
    expect(css).toContain(
      '@media not (prefers-color-scheme: dark){:root:not([data-theme="dark"]) [data-odd-theme="brand"]{--odd-series-1:#ffee00;--odd-series-1-ink:#0b0b0b;--odd-page:#ffffff}}',
    )
    expect(css).toContain(':root[data-theme="dark"] [data-odd-theme="brand"]{--odd-bad:#ff0000')
  })

  it('leaves a mode it does not set alone', () => {
    expect(themeCss('a', { light: { page: '#ffffff' } })).not.toContain('data-theme="dark"] [')
  })
})

describe('inkOnColor', () => {
  it('picks the text colour that contrasts more', () => {
    expect(inkOnColor('#ffee00')).toBe('#0b0b0b')
    expect(inkOnColor('#1a237e')).toBe('#ffffff')
  })
})
