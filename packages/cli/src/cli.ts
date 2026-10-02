import { relative } from 'node:path'
import { init } from './init.js'

const USAGE = `create-open-dashboard — scaffold an open-dashboard workspace

Usage:
  npx @open-database-dashboard/cli init [directory] [--sample]

Arguments:
  directory     Where to create the workspace (default: my-dashboards)

Options:
  --sample      Add a sample SQLite database and a dashboard over it
`

export async function run(argv: string[]): Promise<number> {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE)
    return command ? 0 : 1
  }
  if (command !== 'init') {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`)
    return 1
  }

  const directory = argv.slice(1).find((arg) => !arg.startsWith('--')) ?? 'my-dashboards'
  const result = await init({ directory, sample: argv.includes('--sample') })

  const visible = result.files.filter(
    (file) => !file.startsWith('.claude/') && !file.startsWith('.agents/'),
  )
  process.stdout.write(`\n  Created ${relative(process.cwd(), result.root) || '.'}\n\n`)
  for (const file of visible) process.stdout.write(`    ${file}\n`)
  process.stdout.write(
    `    …and ${result.files.length - visible.length} skill files for your agent\n`,
  )
  process.stdout.write('\n  Next:\n')
  for (const step of result.next) process.stdout.write(`    ${step}\n`)
  process.stdout.write('\n  Then ask your agent: /connect-database, then /create-dashboard\n\n')
  return 0
}
