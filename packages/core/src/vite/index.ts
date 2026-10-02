import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import type { InlineConfig } from 'vite'
import type { ConfigOverrides, Workspace } from '../workspace.js'
import { apiPlugin } from './api-plugin.js'
import { appPlugin } from './app-plugin.js'
import { manifestPlugin } from './manifest-plugin.js'
import { packageRoot, sourceEntry } from './package-root.js'

const require = createRequire(import.meta.url)

const REACT_SPECIFIERS = [
  'react-dom/client',
  'react-dom',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'react',
] as const

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * The viewer ships inside this package, so its React resolves from here — a
 * workspace has no reason to depend on React to describe a dashboard.
 *
 * Anchored regexes, not the object form: object aliases match by prefix, so a
 * `react-dom` entry would rewrite `react-dom/client` into `.../index.js/client`.
 */
function reactAliases(): { find: RegExp; replacement: string }[] {
  const out: { find: RegExp; replacement: string }[] = []
  for (const specifier of REACT_SPECIFIERS) {
    try {
      out.push({
        find: new RegExp(`^${escapeRegExp(specifier)}$`),
        replacement: require.resolve(specifier),
      })
    } catch {
      // leave it to the workspace; a clear resolve error beats a wrong alias
    }
  }
  return out
}

function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * In the browser, dashboards and the viewer both get core from its *source*.
 * One module graph means one React context — a dashboard importing the built
 * bundle while the viewer imported source would render panels that cannot see
 * the filters the viewer provides.
 */
export function viteConfigFor(
  workspace: Workspace,
  overrides: ConfigOverrides = {},
  extra: Partial<InlineConfig> = {},
): InlineConfig {
  const { root, port, dashboardsDir } = workspace.config
  const core = packageRoot()
  return {
    root,
    configFile: false,
    envDir: false,
    logLevel: 'warn',
    appType: 'custom',
    plugins: [
      react({
        include: [
          new RegExp(`^${escapeRegExp(join(realPath(core), 'src'))}/.*\\.[jt]sx?$`),
          new RegExp(`^${escapeRegExp(join(root, dashboardsDir))}/.*\\.[jt]sx?$`),
        ],
      }),
      manifestPlugin(workspace),
      apiPlugin(workspace, overrides),
      appPlugin(),
    ],
    resolve: {
      alias: [
        { find: /^@open-dashboard\/core$/, replacement: sourceEntry('index.ts') },
        {
          find: /^@open-dashboard\/core\/jsx-runtime$/,
          replacement: sourceEntry('jsx-runtime.ts'),
        },
        {
          find: /^@open-dashboard\/core\/jsx-dev-runtime$/,
          replacement: sourceEntry('jsx-dev-runtime.ts'),
        },
        ...reactAliases(),
      ],
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: [...REACT_SPECIFIERS],
      // Installed, core's source sits inside node_modules, and Vite would
      // pre-bundle it as a dependency: a second copy of core beside the
      // aliased one, with its own React context and a broken JSX runtime.
      // Inside the monorepo it is outside node_modules, so only a published
      // install shows this.
      exclude: [
        '@open-dashboard/core',
        '@open-dashboard/core/jsx-runtime',
        '@open-dashboard/core/jsx-dev-runtime',
      ],
      entries: [],
    },
    server: {
      port,
      strictPort: false,
      fs: { allow: [root, realPath(core)] },
    },
    ...extra,
  }
}
