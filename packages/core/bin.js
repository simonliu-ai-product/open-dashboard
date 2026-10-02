#!/usr/bin/env node
import { run } from './dist/cli/bin.mjs'

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    const inner = Array.isArray(error?.errors)
      ? error.errors.map((e) => e?.message).filter(Boolean)
      : []
    process.stderr.write(`${error?.message || inner.join('; ') || error?.code || String(error)}\n`)
    process.exitCode = 1
  })
