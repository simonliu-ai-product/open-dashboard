import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'
import type { DatasourceConfig, OpenDashboardConfig } from './config.js'
import { type Datasource, DatasourceError, openDatasource } from './datasource/index.js'
import { registerSecrets, secretsInEnv, secretsOf } from './datasource/redact.js'
import type { QueryRun } from './ops/dashboards.js'
import { parseDuration, QueryCache } from './ops/query-cache.js'

export const DEFAULT_PORT = 5473
const CONFIG_NAMES = [
  'open-dashboard.config.ts',
  'open-dashboard.config.js',
  'open-dashboard.config.mjs',
]

export interface ResolvedConfig {
  root: string
  dashboardsDir: string
  /** Where custom charts live. Default `charts`. */
  chartsDir: string
  port: number
  datasources: Record<string, DatasourceConfig>
  defaultSource: string | undefined
  maxRows: number
  timeoutMs: number
  /** Default result reuse, in ms. 0: off. */
  cacheMs: number
  /** `themes/<id>.json` used by a dashboard whose `meta.theme` names none. */
  theme: string | undefined
  /** Resolved and usable, or undefined when off or incomplete. */
  assistant: ResolvedAssistant | undefined
  configFile: string | undefined
}

export interface ResolvedAssistant {
  provider: 'gemini' | 'openai'
  model: string
  apiKey: string | undefined
  baseUrl: string
  maxRows: number
  reasoningEffort: 'low' | 'medium' | 'high' | undefined
}

const PROVIDER_URLS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openai: 'https://api.openai.com/v1',
} as const

/** A config that names no model, an unknown provider, or a hosted API with no key turns the assistant off rather than failing. */
const EFFORTS = ['low', 'medium', 'high'] as const

function effort(value: unknown): (typeof EFFORTS)[number] | undefined {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return EFFORTS.find((e) => e === v)
}

export function resolveAssistant(
  input: OpenDashboardConfig['assistant'],
): ResolvedAssistant | undefined {
  if (!input || typeof input !== 'object') return undefined
  const provider = input.provider
  if (provider !== 'gemini' && provider !== 'openai') return undefined
  const model = typeof input.model === 'string' ? input.model.trim() : ''
  if (!model) return undefined
  const apiKey =
    typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : undefined
  const custom =
    typeof input.baseUrl === 'string' && input.baseUrl.trim() ? input.baseUrl.trim() : undefined
  if (!apiKey && !(provider === 'openai' && custom)) return undefined
  return {
    provider,
    model,
    apiKey,
    baseUrl: (custom ?? PROVIDER_URLS[provider]).replace(/\/+$/, ''),
    maxRows:
      typeof input.maxRows === 'number' && input.maxRows > 0 ? Math.min(input.maxRows, 2000) : 200,
    reasoningEffort:
      effort(input.reasoningEffort) ?? (provider === 'gemini' ? 'medium' : undefined),
  }
}

/**
 * Resolved to the real path once, here. Vite reports module ids as real paths,
 * so a root left unresolved never matches them for a workspace behind a symlink
 * — which is every workspace under /tmp on macOS.
 */
function realPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export function configPath(root: string): string | undefined {
  return CONFIG_NAMES.map((name) => join(root, name)).find((path) => existsSync(path))
}

const fromEnvFile = new Map<string, string>()

/**
 * `.env` fills in what the shell has not already set, and a reload replaces
 * what an earlier read of the file put there — so editing `.env` while the dev
 * server runs takes effect without letting the file override a real export.
 */
export function loadEnv(root: string): void {
  for (const [key, value] of fromEnvFile) {
    if (process.env[key] === value) delete process.env[key]
  }
  fromEnvFile.clear()
  for (const name of ['.env', '.env.local']) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    const parsed = parseEnv(readFileSync(path, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined || (process.env[key] !== undefined && !fromEnvFile.has(key))) continue
      process.env[key] = value
      fromEnvFile.set(key, value)
    }
  }
}

function resolveCache(cache: string | false | undefined): number {
  if (cache === false) return 0
  if (cache === undefined) return 30_000
  const ms = parseDuration(cache)
  if (ms === undefined) {
    throw new DatasourceError(
      `cache: "${cache}" is not a duration — use '30s', '5m', '1h' or false`,
    )
  }
  return ms
}

export interface ConfigOverrides {
  port?: number
}

export async function loadConfig(
  rootDir: string,
  overrides: ConfigOverrides = {},
): Promise<ResolvedConfig> {
  const root = realPath(resolve(rootDir))
  loadEnv(root)
  const file = configPath(root)
  let user: Partial<OpenDashboardConfig> = {}
  if (file) {
    const stamp = statSync(file).mtimeMs
    const loaded = (await import(`${pathToFileURL(file).href}?t=${stamp}`)) as {
      default?: OpenDashboardConfig
    }
    user = loaded.default ?? {}
  }
  const datasources = user.datasources ?? {}
  const names = Object.keys(datasources)
  // Before anything can fail and print: every secret this config or the
  // environment holds is masked in messages from here on.
  const assistant = resolveAssistant(user.assistant)
  registerSecrets([
    ...secretsOf(datasources),
    ...secretsInEnv(process.env),
    ...(assistant?.apiKey ? [assistant.apiKey] : []),
  ])
  return {
    root,
    dashboardsDir: user.dashboardsDir ?? 'dashboards',
    chartsDir: user.chartsDir ?? 'charts',
    port: overrides.port ?? DEFAULT_PORT,
    datasources,
    defaultSource: user.defaultSource ?? (names.length === 1 ? names[0] : undefined),
    maxRows: user.maxRows ?? 5000,
    timeoutMs: user.timeoutMs ?? 15_000,
    cacheMs: resolveCache(user.cache),
    theme: user.theme,
    assistant,
    configFile: file,
  }
}

/**
 * Connections are opened lazily and kept for the life of the server: a pool per
 * datasource, not a connection per panel refresh.
 */
export class Workspace {
  private sources = new Map<string, Promise<Datasource>>()
  /** Dashboard query results, shared by every viewer. */
  readonly cache = new QueryCache<QueryRun>()

  constructor(public config: ResolvedConfig) {}

  sourceName(requested?: string): string {
    const name = requested || this.config.defaultSource
    const known = Object.keys(this.config.datasources)
    if (!name) {
      throw new DatasourceError(
        known.length === 0
          ? 'no datasources configured — add one to open-dashboard.config.ts'
          : `this query names no source and there is no default — add "-- source: <name>" (one of ${known.join(', ')}) or set defaultSource`,
      )
    }
    if (!this.config.datasources[name]) {
      throw new DatasourceError(
        `unknown datasource "${name}"${known.length ? ` — configured: ${known.join(', ')}` : ''}`,
      )
    }
    return name
  }

  source(requested?: string): Promise<Datasource> {
    const name = this.sourceName(requested)
    let pending = this.sources.get(name)
    if (!pending) {
      pending = openDatasource(
        name,
        this.config.datasources[name] as DatasourceConfig,
        this.config.root,
      )
      pending.catch(() => this.sources.delete(name))
      this.sources.set(name, pending)
    }
    return pending
  }

  async reconfigure(config: ResolvedConfig): Promise<void> {
    await this.close()
    this.cache.clear()
    this.config = config
  }

  async close(): Promise<void> {
    const open = [...this.sources.values()]
    this.sources.clear()
    await Promise.allSettled(open.map(async (pending) => (await pending).close()))
  }
}
