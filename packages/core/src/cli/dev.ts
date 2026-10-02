import { createServer } from 'vite'
import { discoverDashboards } from '../ops/dashboards.js'
import { viteConfigFor } from '../vite/index.js'
import { type ConfigOverrides, loadConfig, Workspace } from '../workspace.js'

export interface DevOptions {
  root?: string
  port?: number
  host?: string
  open?: boolean
}

export async function dev(
  options: DevOptions = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const overrides: ConfigOverrides = options.port ? { port: options.port } : {}
  const config = await loadConfig(options.root ?? process.cwd(), overrides)
  const workspace = new Workspace(config)
  const inline = viteConfigFor(workspace, overrides)
  if (options.host) inline.server = { ...inline.server, host: options.host }

  const server = await createServer(inline)
  await server.listen()

  const url = server.resolvedUrls?.local?.[0] ?? `http://localhost:${config.port}/`
  const found = discoverDashboards(config.root, config.dashboardsDir)
  const sources = Object.keys(config.datasources)
  const out = process.stdout
  out.write(`\n  open-dashboard  ${url}\n`)
  out.write(
    sources.length === 0
      ? '  no datasources — add one to open-dashboard.config.ts\n'
      : `  datasources: ${sources.map((s) => `${s} (${config.datasources[s]?.type})`).join(', ')}\n`,
  )
  out.write(
    found.length === 0
      ? `  no dashboards yet — ask your agent: /create-dashboard\n\n`
      : `  ${found.length} dashboard${found.length === 1 ? '' : 's'}: ${found.map((f) => f.id).join(', ')}\n\n`,
  )
  if (options.open) server.openBrowser()

  return {
    url,
    close: async () => {
      const http = server.httpServer as { closeAllConnections?: () => void } | null
      http?.closeAllConnections?.()
      await server.close()
      await workspace.close()
    },
  }
}
