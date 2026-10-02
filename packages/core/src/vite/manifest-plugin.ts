import { join } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { discoverDashboards } from '../ops/dashboards.js'
import type { Workspace } from '../workspace.js'

const MANIFEST_ID = 'virtual:open-dashboard/manifest'
const RESOLVED_ID = `\0${MANIFEST_ID}`

/**
 * The viewer never scans the filesystem. It imports this module, regenerated
 * whenever a dashboard folder appears or disappears, so the browser only ever
 * sees lazy imports.
 */
export function manifestPlugin(workspace: Workspace): Plugin {
  let server: ViteDevServer | undefined

  const generate = (): string => {
    const { root, dashboardsDir } = workspace.config
    const entries = discoverDashboards(root, dashboardsDir)
      .map(
        ({ id, file }) =>
          `  { id: ${JSON.stringify(id)}, load: () => import(${JSON.stringify(file)}) }`,
      )
      .join(',\n')
    return `export const dashboards = [\n${entries}\n]\n`
  }

  const invalidate = (path: string): void => {
    if (!server) return
    if (!path.startsWith(join(workspace.config.root, workspace.config.dashboardsDir))) return
    const module = server.moduleGraph.getModuleById(RESOLVED_ID)
    if (!module) return
    server.moduleGraph.invalidateModule(module)
    server.ws.send({ type: 'full-reload' })
  }

  return {
    name: 'open-dashboard:manifest',
    resolveId(id) {
      return id === MANIFEST_ID ? RESOLVED_ID : undefined
    },
    load(id) {
      return id === RESOLVED_ID ? generate() : undefined
    },
    configureServer(devServer) {
      server = devServer
      for (const event of ['add', 'unlink', 'addDir', 'unlinkDir'] as const) {
        devServer.watcher.on(event, invalidate)
      }
    },
  }
}
