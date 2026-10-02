import { chromium } from 'playwright'

const [base, out] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

await page.goto(`${base}/d/getting-started`, { waitUntil: 'networkidle' })
await page.waitForSelector('.odd-line')

const plot = page
  .locator('.odd-panel', { hasText: 'Revenue by week' })
  .locator('svg rect[fill="transparent"]')
const box = await plot.boundingBox()
await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
await page.waitForSelector('.odd-tooltip')
console.log('tooltip:', (await page.locator('.odd-tooltip').innerText()).replace(/\n/g, ' | '))
await page.screenshot({ path: `${out}/hover.png` })

const before = await page
  .locator('.odd-panel', { hasText: 'Orders' })
  .first()
  .locator('.odd-stat-value')
  .innerText()
await page.selectOption('.odd-filter select', '12m')
await page.waitForFunction((prev) => {
  const el = [...document.querySelectorAll('.odd-panel')]
    .find((p) => p.textContent.includes('Orders'))
    ?.querySelector('.odd-stat-value')
  return el && el.textContent !== prev
}, before)
const after = await page
  .locator('.odd-panel', { hasText: 'Orders' })
  .first()
  .locator('.odd-stat-value')
  .innerText()
console.log(`orders 90d=${before} → 12m=${after}; url=${page.url()}`)

await page.locator('.odd-panel', { hasText: 'Products by revenue' }).hover()
await page.getByRole('button', { name: 'Inspect Products by revenue' }).click()
await page.waitForSelector('.odd-inspector .odd-facts')
console.log('inspector:', (await page.locator('.odd-facts').innerText()).replace(/\n/g, ' '))
await page.getByRole('tab', { name: 'SQL' }).click()
await page.screenshot({ path: `${out}/inspector.png` })
await page.fill('#odd-note', 'Show the top 3 only, and add units sold')
await page.getByRole('button', { name: 'Leave note' }).click()
await page.waitForFunction(() =>
  document.querySelector('.odd-note-actions')?.textContent?.includes('Saved'),
)
console.log('note:', await page.locator('.odd-note-actions .odd-muted').innerText())
await page.waitForTimeout(1500)
console.log(
  'pill:',
  await page
    .locator('.odd-notes-pill')
    .innerText()
    .catch(() => '(none)'),
)

const current = await (await fetch(`${base}/__odd/api/current`)).json()
console.log('current:', JSON.stringify(current))
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'no page errors')
await browser.close()
