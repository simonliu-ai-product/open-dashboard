import { chromium } from 'playwright'

// Drives the Charts and Themes pages against a running viewer: node scripts/pages.mjs http://localhost:5473
const [base = 'http://localhost:5473'] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

await page.goto(`${base}/charts`, { waitUntil: 'networkidle' })
await page.waitForSelector('.odd-gallery-list a')
const listed = await page.locator('.odd-gallery-list a').count()
if (listed < 40) fail(`Charts lists ${listed} charts, expected at least the 40 built-ins`)
else console.log(`✓ Charts lists ${listed} charts`)

await page.goto(`${base}/charts/BarChart`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const preview = page.locator('.odd-gallery-stage .odd-panel')
if ((await preview.count()) === 0) fail('BarChart has no preview')
else if ((await preview.locator('.odd-panel-error').count()) > 0) fail('BarChart preview failed')
else console.log('✓ BarChart previews a real panel')
await preview.hover()
if ((await preview.locator('.odd-panel-actions > button').count()) > 0)
  fail('a preview shows an Inspect button that cannot open anything')

await page.fill('.odd-gallery-search', 'sankey')
const found = await page.locator('.odd-gallery-list a').count()
if (found !== 1) fail(`searching "sankey" found ${found}`)
else console.log('✓ search narrows the list')

await page.locator('.odd-gallery-list').hover()
for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 400)
if ((await page.evaluate(() => window.scrollY)) !== 0) fail('scrolling the list scrolled the page')
else console.log('✓ the list scrolls on its own')

await page.goto(`${base}/themes`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
if ((await page.locator('.odd-studio-panel').count()) === 0) {
  console.log('· no themes in this workspace, editor not checked')
} else {
  await page.waitForSelector('.odd-studio-canvas .odd-panel')
  const name = page.locator('.odd-studio-panel input[type=text]').first()
  const before = await name.inputValue()
  await name.fill(`${before} (unsaved)`)
  await page.locator('nav.odd-nav a').first().click()
  await page.waitForTimeout(300)
  if (!page.url().includes('/themes')) fail('leaving with unsaved theme changes was not blocked')
  else console.log('✓ unsaved theme changes block leaving')
  await name.fill(before)
}

console.log(errors.length ? `errors:\n${errors.join('\n')}` : '✓ no page errors')
await browser.close()
