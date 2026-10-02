export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

/**
 * Every package manager sets npm_config_user_agent when it runs a binary, so the
 * scaffolded workspace can suggest the one the user actually invoked it with.
 *
 * Passing `undefined` reads the environment; pass `''` for "no agent", which is
 * what a test wants — otherwise it asserts on whatever ran the test.
 */
export function detectPackageManager(agent = process.env.npm_config_user_agent): PackageManager {
  if (!agent) return 'npm'
  if (agent.startsWith('pnpm')) return 'pnpm'
  if (agent.startsWith('yarn')) return 'yarn'
  if (agent.startsWith('bun')) return 'bun'
  return 'npm'
}

export function installCommand(manager: PackageManager): string {
  return manager === 'yarn' ? 'yarn' : `${manager} install`
}

export function runCommand(manager: PackageManager, script: string): string {
  return manager === 'npm' ? `npm run ${script}` : `${manager} ${script}`
}
