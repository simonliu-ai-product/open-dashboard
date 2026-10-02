import { chromium } from 'playwright'

const [url, out, theme = 'light', width = '1440', height = '1100'] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  colorScheme: theme,
})
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.screenshot({ path: out, fullPage: true })
for (const text of await page.locator('.odd-callout-error, .odd-panel-error').allInnerTexts())
  logs.push(`on page: ${text.replace(/\s+/g, ' ')}`)
console.log(logs.join('\n') || 'no console errors')
await browser.close()
