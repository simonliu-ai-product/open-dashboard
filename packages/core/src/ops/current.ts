import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ParamValue } from '../config.js'
import type { ResolvedConfig } from '../workspace.js'

export interface CurrentView {
  id?: string
  title?: string
  panel?: string
  query?: string
  params?: Record<string, ParamValue>
  url?: string
  updatedAt?: string
}

export function currentPath(config: ResolvedConfig): string {
  return join(config.root, 'node_modules', '.open-dashboard', 'current.json')
}

export function getCurrent(config: ResolvedConfig): CurrentView | undefined {
  const path = currentPath(config)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as CurrentView
  } catch {
    return undefined
  }
}

export function setCurrent(config: ResolvedConfig, view: CurrentView, now: string): CurrentView {
  const next: CurrentView = { ...view, updatedAt: now }
  const path = currentPath(config)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  return next
}
