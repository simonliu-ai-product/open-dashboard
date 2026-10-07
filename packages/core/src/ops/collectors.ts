import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { redact } from '../datasource/redact.js'
import { errorMessage } from '../datasource/types.js'
import type { ResolvedCollector, ResolvedConfig, Workspace } from '../workspace.js'
import { OpsError } from './errors.js'

export interface CollectorRun {
  startedAt: string
  finishedAt: string
  ok: boolean
  exitCode: number | null
  durationMs: number
  /** The end of what it printed, masked like every other message. */
  output: string
}

export interface CollectorStatus {
  id: string
  source?: string
  every?: string
  running: boolean
  last?: CollectorRun
  /** When the schedule runs it next; absent without `every`. */
  next?: string
}

const OUTPUT_TAIL = 4000

export function collectorStatePath(config: ResolvedConfig): string {
  return join(config.root, 'node_modules', '.open-dashboard', 'collectors.json')
}

function readState(config: ResolvedConfig): Record<string, CollectorRun> {
  const path = collectorStatePath(config)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, CollectorRun>
  } catch {
    return {}
  }
}

function writeRun(config: ResolvedConfig, id: string, run: CollectorRun): void {
  const path = collectorStatePath(config)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ ...readState(config), [id]: run }, null, 2)}\n`)
}

function nextRun(collector: ResolvedCollector, last: CollectorRun | undefined): Date | undefined {
  if (!collector.everyMs) return undefined
  if (!last) return new Date(0)
  return new Date(Date.parse(last.startedAt) + collector.everyMs)
}

export function listCollectors(workspace: Workspace): CollectorStatus[] {
  const state = readState(workspace.config)
  return Object.values(workspace.config.collectors).map((collector) => {
    const last = state[collector.id]
    const next = nextRun(collector, last)
    const status: CollectorStatus = {
      id: collector.id,
      running: workspace.collecting.has(collector.id),
    }
    if (collector.source) status.source = collector.source
    if (collector.every) status.every = collector.every
    if (last) status.last = last
    if (next) status.next = next.toISOString()
    return status
  })
}

function execute(collector: ResolvedCollector, root: string): Promise<CollectorRun> {
  const started = Date.now()
  return new Promise((resolve) => {
    let output = ''
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_TAIL * 2)
    }
    const finish = (exitCode: number | null, note?: string) => {
      clearTimeout(timer)
      const text = (note ? `${output}\n${note}` : output).trim().slice(-OUTPUT_TAIL)
      resolve({
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date().toISOString(),
        ok: exitCode === 0 && !note,
        exitCode,
        durationMs: Date.now() - started,
        output: redact(text),
      })
    }
    const [command, ...args] = Array.isArray(collector.run) ? collector.run : [collector.run]
    const child = spawn(command as string, args, {
      cwd: root,
      env: process.env,
      shell: !Array.isArray(collector.run),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }, collector.timeoutMs)
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('error', (error) => finish(null, errorMessage(error)))
    child.on('close', (code) =>
      finish(
        code,
        timedOut ? `stopped after ${Math.round(collector.timeoutMs / 1000)} s` : undefined,
      ),
    )
  })
}

/**
 * Runs a collector named in the config — the only commands this will start.
 * One run at a time per collector: asking again while it runs joins that run.
 * The result cache is cleared afterwards, since the data underneath changed.
 */
export function runCollector(workspace: Workspace, id: string): Promise<CollectorRun> {
  const collector = workspace.config.collectors[id]
  if (!collector) throw new OpsError(`no collector "${id}" in open-dashboard.config`, 404)
  const running = workspace.collecting.get(id) as Promise<CollectorRun> | undefined
  if (running) return running
  const config = workspace.config
  const run = execute(collector, config.root).then((result) => {
    writeRun(config, id, result)
    workspace.cache.clear()
    return result
  })
  workspace.collecting.set(id, run)
  run.finally(() => workspace.collecting.delete(id))
  return run
}

/**
 * The dev server's schedule: every collector with `every` runs when its last
 * run is that old (or it never ran). Read from the config each time, so a
 * config reload changes the schedule without a restart.
 */
export function scheduleCollectors(
  workspace: Workspace,
  onRun: (id: string, run: CollectorRun) => void,
  tickMs = 30_000,
): () => void {
  const tick = () => {
    const state = readState(workspace.config)
    for (const collector of Object.values(workspace.config.collectors)) {
      const next = nextRun(collector, state[collector.id])
      if (!next || next.getTime() > Date.now() || workspace.collecting.has(collector.id)) continue
      runCollector(workspace, collector.id).then((run) => onRun(collector.id, run))
    }
  }
  tick()
  const timer = setInterval(tick, tickMs)
  timer.unref()
  return () => clearInterval(timer)
}
