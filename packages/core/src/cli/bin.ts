import type { ParamValue } from '../config.js'
import { DRIVERS } from '../datasource/registry.js'
import { errorMessage } from '../datasource/types.js'
import {
  checkWorkspace,
  listSources,
  readDatabaseDoc,
  readSchema,
  runDashboardQuery,
  runSql,
  SKILL_DIRS,
  schemaToText,
  syncSkills,
} from '../ops/index.js'
import { loadConfig, Workspace } from '../workspace.js'
import { dev } from './dev.js'
import { formatResult } from './table.js'

const USAGE = `open-dashboard — describe a dashboard to your agent, get a live one over your database

Usage:
  open-dashboard <command> [options]

Commands:
  dev                       Start the viewer with hot reload (default port 5473)
  drivers                   Supported databases, the package each needs, how it stays read-only
  sources                   List datasources and test each connection
  schema [source]           Print tables, columns, keys and row counts
  query "<sql>"             Run read-only SQL against a datasource
  query --dashboard <id> --name <query>
                            Run one of a dashboard's named queries
  check [id]                Run every query of every dashboard, verify panels
  sync-skills               Update the agent skills in this workspace to the installed version

Options:
  --help                 Show this, from any command
  --root <dir>           Workspace root (default: cwd)
  --port <n>             Port for dev
  --host <host>          Bind address for dev
  --open                 Open a browser (dev)
  --source <name>        Datasource for query/schema (default: defaultSource)
  --param <key=value>    Bind :key in the SQL; repeatable. "null" binds NULL
  --limit <n>            Rows to print for query (default 50)
  --json                 Machine-readable output (schema, query, check, sources)
`

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return argv[index + 1]
}

function flags(argv: string[], name: string): string[] {
  const out: string[] = []
  argv.forEach((arg, i) => {
    if (arg === `--${name}` && argv[i + 1] !== undefined) out.push(argv[i + 1] as string)
  })
  return out
}

const VALUE_FLAGS = new Set([
  '--root',
  '--port',
  '--host',
  '--source',
  '--param',
  '--limit',
  '--dashboard',
  '--name',
])

function positional(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] as string
    if (VALUE_FLAGS.has(arg)) {
      i += 1
      continue
    }
    if (!arg.startsWith('--')) out.push(arg)
  }
  return out
}

function parseParam(raw: string): [string, ParamValue] {
  const eq = raw.indexOf('=')
  if (eq <= 0) throw new Error(`--param expects key=value, got "${raw}"`)
  const key = raw.slice(0, eq)
  const value = raw.slice(eq + 1)
  if (value === 'null') return [key, null]
  if (/^-?\d+(\.\d+)?$/.test(value)) return [key, Number(value)]
  return [key, value]
}

const HELP = ['--help', '-h', 'help']

/** An error as the user may see it: readable, and with any secret in it masked. */
export function describeError(error: unknown): string {
  return errorMessage(error)
}

export async function run(argv: string[]): Promise<number> {
  const command = argv[0]
  if (!command || argv.some((arg) => HELP.includes(arg))) {
    process.stdout.write(USAGE)
    return command ? 0 : 1
  }

  const root = flag(argv, 'root') ?? process.cwd()
  const json = argv.includes('--json')
  const out = (text: string) => process.stdout.write(text)

  if (command === 'dev') {
    const options: Parameters<typeof dev>[0] = { root, open: argv.includes('--open') }
    const port = flag(argv, 'port')
    if (port) options.port = Number(port)
    const host = flag(argv, 'host')
    if (host) options.host = host
    await dev(options)
    return new Promise<number>(() => {})
  }

  if (command === 'sync-skills') {
    const names = syncSkills(root)
    out(`updated ${names.length} skills in ${SKILL_DIRS.join(' and ')}: ${names.join(', ')}\n`)
    return 0
  }

  if (command === 'drivers') {
    if (json) {
      out(`${JSON.stringify(DRIVERS, null, 2)}\n`)
      return 0
    }
    for (const driver of DRIVERS) {
      const install = driver.package ? `pnpm add ${driver.package}` : 'built in'
      out(`${driver.label.padEnd(11)} type: '${driver.type}'  ${install}\n`)
      if (driver.compatible.length) out(`${' '.repeat(13)}also: ${driver.compatible.join(', ')}\n`)
      out(`${' '.repeat(13)}read-only: ${driver.readOnly}\n`)
      out(`${' '.repeat(13)}${driver.example}\n\n`)
    }
    return 0
  }

  const known = ['sources', 'schema', 'query', 'check']
  if (!known.includes(command)) {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`)
    return 1
  }

  const workspace = new Workspace(await loadConfig(root))
  try {
    if (command === 'sources') {
      const sources = await listSources(workspace)
      if (json) out(`${JSON.stringify(sources, null, 2)}\n`)
      else if (sources.length === 0) out('no datasources — add one to open-dashboard.config.ts\n')
      else {
        for (const s of sources) {
          out(
            `${s.ok ? '✓' : '✗'} ${s.name} (${s.type})${s.default ? ' [default]' : ''}  ${s.ok ? `${s.tables} tables/views` : s.error}\n`,
          )
        }
      }
      return sources.every((s) => s.ok) ? 0 : 1
    }

    if (command === 'schema') {
      const requested = positional(argv)[0] ?? flag(argv, 'source')
      const schema = await readSchema(workspace, requested)
      const doc = readDatabaseDoc(workspace.config, workspace.sourceName(requested))
      if (json) {
        out(
          `${JSON.stringify({ ...schema, notes: doc.markdown === null ? null : doc.file }, null, 2)}\n`,
        )
        return 0
      }
      // The agent reads this first: point it at what the tables mean.
      out(
        doc.markdown === null
          ? `notes: none yet — write ${doc.file} (skill: document-database)\n\n`
          : `notes: ${doc.file} — read it before writing SQL\n\n`,
      )
      out(schemaToText(schema))
      return 0
    }

    if (command === 'query') {
      const params = Object.fromEntries(flags(argv, 'param').map(parseParam))
      const dashboard = flag(argv, 'dashboard')
      const name = flag(argv, 'name')
      let result: Awaited<ReturnType<typeof runSql>>
      if (dashboard || name) {
        if (!dashboard || !name) throw new Error('--dashboard and --name go together')
        const ran = await runDashboardQuery(workspace, dashboard, name, params, { fresh: true })
        if (!json)
          out(`-- ${ran.query.name} on ${ran.query.source} (${ran.query.file}:${ran.query.line})\n`)
        result = ran.result
      } else {
        const sql = positional(argv)[0]
        if (!sql) throw new Error('query needs SQL in quotes, or --dashboard <id> --name <query>')
        result = await runSql(workspace, sql, flag(argv, 'source'), params)
      }
      out(
        json
          ? `${JSON.stringify(result, null, 2)}\n`
          : formatResult(result, Number(flag(argv, 'limit') ?? 50)),
      )
      return 0
    }

    const reports = await checkWorkspace(workspace, positional(argv)[0])
    if (json) {
      out(`${JSON.stringify(reports, null, 2)}\n`)
    } else if (reports.length === 0) {
      out(
        `no dashboards${positional(argv)[0] ? ` named "${positional(argv)[0]}"` : ''} under ${workspace.config.dashboardsDir}/\n`,
      )
    } else {
      for (const report of reports) {
        const errors = report.findings.filter((f) => f.severity === 'error').length
        out(`${errors ? '✗' : '✓'} ${report.title} (${report.id})\n`)
        const params = Object.entries(report.params)
        if (params.length)
          out(`  params: ${params.map(([k, v]) => `${k}=${v === null ? 'null' : v}`).join(' ')}\n`)
        for (const q of report.queries) {
          out(
            q.error
              ? `  ✗ ${q.name}: ${q.error}\n`
              : `  · ${q.name}: ${q.rows} rows, ${q.elapsedMs} ms [${q.columns?.join(', ')}]\n`,
          )
        }
        for (const f of report.findings) {
          if (f.message.startsWith('query "') && f.message.includes(' failed: ')) continue
          out(
            `  ${f.severity === 'error' ? 'error' : 'warn '}: ${f.message}${f.where ? `  (${f.where})` : ''}\n`,
          )
        }
      }
    }
    return reports.some((r) => r.findings.some((f) => f.severity === 'error')) ? 1 : 0
  } finally {
    await workspace.close()
  }
}
