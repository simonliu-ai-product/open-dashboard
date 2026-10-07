import { toNodeHandler } from '@modelcontextprotocol/node'
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  originValidationResponse,
} from '@modelcontextprotocol/server'
import { type ServeStdioOptions, serveStdio } from '@modelcontextprotocol/server/stdio'
import type { Workspace } from '@open-dashboard/core/node'
import { registerTools } from './tools.js'

export interface OpenDashboardMcpOptions {
  /** The dev server's workspace: one config, one set of connections, one result cache. */
  workspace: Workspace
  /**
   * Register run_sql — read-only SQL of the agent's own. Off unless asked for
   * (`open-dashboard dev --mcp --allow-sql`): the viewer itself never sends SQL.
   */
  allowSql?: boolean
  version?: string
  /** Extra hostnames for Host/Origin. Loopback is always allowed; add only when deliberately exposed. */
  allowedHosts?: string[]
}

/**
 * A fresh server per request: every tool reads or writes the workspace, so no
 * state is carried between calls — the stateless shape that lets any client
 * connect without a session handshake.
 */
export function createOpenDashboardMcpServer(options: OpenDashboardMcpOptions): McpServer {
  const server = new McpServer({
    name: 'open-dashboard',
    version: options.version ?? '0.0.0',
    title: 'open-dashboard',
  })
  registerTools(server, options.workspace, { allowSql: options.allowSql ?? false })
  return server
}

export function createOpenDashboardMcpHandler(options: OpenDashboardMcpOptions) {
  const hostnames = [...localhostAllowedHostnames(), ...(options.allowedHosts ?? [])]
  const origins = [...localhostAllowedOrigins(), ...(options.allowedHosts ?? [])]
  const handler = createMcpHandler(() => createOpenDashboardMcpServer(options))
  return {
    ...handler,
    /**
     * The tools write dashboards and run queries, so a page in a browser must
     * not reach them: an unexpected Host or Origin is refused, which closes the
     * DNS-rebinding path onto a loopback endpoint.
     */
    fetch: async (request: Request): Promise<Response> =>
      hostHeaderValidationResponse(request, hostnames) ??
      originValidationResponse(request, origins) ??
      handler.fetch(request),
  }
}

/** Connect-style middleware, for mounting on the dev server. */
export function createOpenDashboardMcpMiddleware(options: OpenDashboardMcpOptions) {
  return toNodeHandler(createOpenDashboardMcpHandler(options))
}

/**
 * The same tools over this process's stdin and stdout, for clients that start
 * a server themselves (Claude Desktop, most agent frameworks). The client that
 * spawned the process is the only caller, so there is no Host or Origin to
 * check. Nothing else may write to stdout: it is the protocol.
 */
export function serveOpenDashboardStdio(
  options: OpenDashboardMcpOptions & Pick<ServeStdioOptions, 'transport' | 'onerror'>,
) {
  const { transport, onerror, ...rest } = options
  return serveStdio(() => createOpenDashboardMcpServer(rest), { transport, onerror })
}
