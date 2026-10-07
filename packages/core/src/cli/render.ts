import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OpsError } from '../ops/errors.js'
import type { Workspace } from '../workspace.js'
import { exportHtml } from './build.js'

export const RENDER_INSTALL = 'pnpm add -D playwright && pnpm exec playwright install chromium'

export interface RenderOptions {
  /** A panel's title; omit for the whole dashboard. */
  panel?: string
  /** Filter values by key, as the URL has them (`time`, `region`); unset filters keep their default. */
  values?: Record<string, string | null>
  theme?: 'light' | 'dark'
  /** Page width in CSS pixels. Default 1280. */
  width?: number
}

export interface Rendered {
  png: Buffer
  width: number
  height: number
  /** The panel titles on the page, to name one when asked for a missing title. */
  panels: string[]
}

interface Chromium {
  launch(options?: { headless?: boolean }): Promise<Browser>
}
interface Browser {
  newPage(options: Record<string, unknown>): Promise<Page>
  close(): Promise<void>
}
interface Locator {
  screenshot(options?: Record<string, unknown>): Promise<Buffer>
  boundingBox(): Promise<{ width: number; height: number } | null>
  count(): Promise<number>
  first(): Locator
  filter(options: Record<string, unknown>): Locator
  allTextContents(): Promise<string[]>
}
interface Page {
  setContent(html: string, options?: Record<string, unknown>): Promise<void>
  waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>
  waitForFunction(
    fn: () => boolean,
    arg?: unknown,
    options?: Record<string, unknown>,
  ): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  locator(selector: string): Locator
}

/** Playwright is the workspace's to install — rendering is for agents, not every reader. */
async function chromium(root: string): Promise<Chromium> {
  for (const anchor of [join(root, 'package.json'), import.meta.url]) {
    if (!anchor.startsWith('file:') && !existsSync(anchor)) continue
    for (const name of ['playwright', 'playwright-core']) {
      try {
        const resolved = createRequire(anchor).resolve(name)
        const mod = (await import(pathToFileURL(resolved).href)) as {
          chromium?: Chromium
          default?: { chromium?: Chromium }
        }
        const found = mod.chromium ?? mod.default?.chromium
        if (found) return found
      } catch {
        // try the next one
      }
    }
  }
  throw new OpsError(`rendering needs Playwright — run: ${RENDER_INSTALL}`, 501)
}

/**
 * A panel (or the whole dashboard) as the reader would see it, as a PNG — so
 * an agent can look at what it wrote: labels that collide, a chart type that
 * hides the point, colours too close to tell apart. It renders the one-file
 * export in a headless browser: no dev server needed, the same drawing code
 * as the page, and only the filter values asked for are run.
 */
export async function renderDashboard(
  workspace: Workspace,
  id: string,
  options: RenderOptions = {},
): Promise<Rendered> {
  const browserType = await chromium(workspace.config.root)
  const values = options.values ?? {}
  const search = new URLSearchParams(
    Object.entries(values).map(([key, value]) => [key, value ?? '']),
  ).toString()
  const html = await exportHtml(workspace, id, search, { maxRuns: 1, values })
  let browser: Browser
  try {
    browser = await browserType.launch()
  } catch (error) {
    throw new OpsError(
      `Playwright could not start Chromium — run: pnpm exec playwright install chromium (${String(error).split('\n')[0]})`,
      501,
    )
  }
  try {
    const page = await browser.newPage({
      viewport: { width: options.width ?? 1280, height: 900 },
      colorScheme: options.theme ?? 'light',
    })
    await page.setContent(html, { waitUntil: 'load' })
    await page.waitForSelector('.odd-dashboard-page', { timeout: 20_000 })
    // Every panel has its rows: no skeleton left, then a beat for layout to settle.
    await page.waitForFunction(() => !document.querySelector('.odd-panel-skeleton'), undefined, {
      timeout: 20_000,
    })
    await page.waitForTimeout(300)
    const panels = await page.locator('.odd-panel-titles h3').allTextContents()
    let target = page.locator('.odd-dashboard-page')
    if (options.panel) {
      const wanted = options.panel
      const match = page
        .locator('.odd-panel')
        .filter({ has: page.locator('.odd-panel-titles h3').filter({ hasText: wanted }) })
      if ((await match.count()) === 0)
        throw new OpsError(
          `no panel titled "${wanted}" — the panels are: ${panels.join('; ')}`,
          404,
        )
      target = match.first()
    }
    const box = await target.boundingBox()
    const png = await target.screenshot({ animations: 'disabled' })
    return { png, width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0), panels }
  } finally {
    await browser.close()
  }
}
