import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Plugin } from 'vite'
import type { Workspace } from '../workspace.js'
import { packageRoot } from './package-root.js'

export const MCP_ENDPOINT = '/mcp'
const PACKAGE = '@open-dashboard/mcp'

type Middleware = (req: unknown, res: unknown, next: (error?: unknown) => void) => void

interface McpOptions {
  workspace: Workspace
  allowSql: boolean
  version: string
}

interface McpModule {
  createOpenDashboardMcpMiddleware(options: McpOptions): Middleware
  serveOpenDashboardStdio(options: McpOptions & { onerror?: (error: Error) => void }): {
    close(): Promise<void>
  }
}

export const MCP_INSTALL = 'pnpm add -D @open-dashboard/mcp'

export function coreVersion(): string {
  return (
    JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version: string }
  ).version
}

/** The workspace installs the package, so resolve it from there first, then from core. */
export async function importMcp(root: string): Promise<McpModule | undefined> {
  for (const anchor of [join(resolve(root), 'package.json'), import.meta.url]) {
    if (!anchor.startsWith('file:') && !existsSync(anchor)) continue
    try {
      const resolved = createRequire(anchor).resolve(PACKAGE)
      return (await import(pathToFileURL(resolved).href)) as McpModule
    } catch {
      // try the next anchor
    }
  }
  return undefined
}

/**
 * Mounts `@open-dashboard/mcp` at /mcp on the dev server, over the server's
 * own workspace: an agent's tool call and the person in the viewer share one
 * config, one set of connections and one result cache, and a dashboard the
 * agent writes reloads in the browser. The package is not a dependency of
 * core — the MCP SDK only matters to people wiring up agents — so a missing
 * install is reported, never fatal.
 */
export function mcpPlugin(
  workspace: Workspace,
  options: { allowSql: boolean; onMissing: () => void },
): Plugin {
  return {
    name: 'open-dashboard:mcp',
    apply: 'serve',
    async configureServer(server) {
      const mod = await importMcp(workspace.config.root)
      if (!mod) {
        options.onMissing()
        return
      }
      const middleware = mod.createOpenDashboardMcpMiddleware({
        workspace,
        allowSql: options.allowSql,
        version: coreVersion(),
      })
      server.middlewares.use(MCP_ENDPOINT, middleware)
    },
  }
}
