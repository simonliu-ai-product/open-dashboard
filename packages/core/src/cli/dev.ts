import { createServer } from 'vite'
import { discoverDashboards } from '../ops/dashboards.js'
import { staleSkills } from '../ops/skills.js'
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
  // A fresh workspace is told one step at a time: a database, then a dashboard.
  if (sources.length === 0) {
    out.write('  next: connect a database — ask your agent: /connect-database\n\n')
  } else {
    out.write(
      `  datasources: ${sources.map((s) => `${s} (${config.datasources[s]?.type})`).join(', ')}\n`,
    )
    out.write(
      found.length === 0
        ? '  next: ask your agent: /create-dashboard\n\n'
        : `  ${found.length} dashboard${found.length === 1 ? '' : 's'}: ${found.map((f) => f.id).join(', ')}\n`,
    )
    if (config.assistant)
      out.write(`  assistant: ${config.assistant.provider} · ${config.assistant.model}\n`)
    out.write('\n')
  }
  const stale = staleSkills(config.root)
  if (stale.length) {
    out.write(
      `  skills: ${stale.length === 1 ? '1 is' : `${stale.length} are`} older than this version of open-dashboard — run: open-dashboard sync-skills\n\n`,
    )
  }
  if (options.host) {
    // The dev API has no login: on a network address, anyone who can reach it
    // can run the dashboards' queries and read the schema.
    out.write(
      '  warning: --host serves this workspace to your network with no login.\n' +
        '           Anyone who can reach it can read the dashboards and their data.\n' +
        '           Use it on a network you trust, and stop it when you are done.\n\n',
    )
  }
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
