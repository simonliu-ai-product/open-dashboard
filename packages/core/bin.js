#!/usr/bin/env node
import { describeError, run } from './dist/cli/bin.mjs'

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    // Masked like every other message: a driver can echo its connection string.
    process.stderr.write(`${describeError(error)}\n`)
    process.exitCode = 1
  })
