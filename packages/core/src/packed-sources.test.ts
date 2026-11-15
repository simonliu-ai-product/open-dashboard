import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Browsers get core from its source: a workspace's Vite compiles `src/` out of
 * the installed package (see `viteConfigFor`). So everything the viewer and the
 * dashboard runtime import has to be in `files`, or a fresh workspace fails at
 * `open-dashboard dev` with "Could not resolve" — open-doc 0.14.0 shipped that
 * way. Type-only imports are erased and need not ship.
 */
const pkgDir = path.resolve(import.meta.dirname, '..')
const files: string[] = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).files

const RUNTIME_IMPORT =
  /^(?:import|export)\s+(?!type\b)[^;]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/gms

function resolve(from: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(from), spec)
  const stem = base.replace(/\.js$/, '')
  return [base, `${stem}.ts`, `${stem}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
    (c) => fs.existsSync(c) && fs.statSync(c).isFile(),
  )
}

function matches(rel: string, entry: string): boolean {
  if (entry.includes('*')) {
    const re = new RegExp(
      `^${entry
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*/g, '[^/]*')}$`,
    )
    return re.test(rel)
  }
  return rel === entry || rel.startsWith(`${entry}/`)
}

function isPacked(file: string): boolean {
  const rel = path.relative(pkgDir, file).split(path.sep).join('/')
  const included = files.some((e) => !e.startsWith('!') && matches(rel, e))
  const excluded = files.some((e) => e.startsWith('!') && matches(rel, e.slice(1)))
  return included && !excluded
}

describe('packed sources', () => {
  it('ships every file the browser imports from source', () => {
    const entries = ['src/index.ts', 'src/jsx-runtime.ts', 'src/jsx-dev-runtime.ts', 'src/app']
    const start = entries.flatMap((e) => {
      const p = path.join(pkgDir, e)
      if (!fs.statSync(p).isDirectory()) return [p]
      return (fs.readdirSync(p, { recursive: true }) as string[])
        .map((f) => path.join(p, f))
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    })
    const seen = new Set<string>()
    const missing: string[] = []
    const walk = (file: string) => {
      if (seen.has(file)) return
      seen.add(file)
      for (const m of fs.readFileSync(file, 'utf8').matchAll(RUNTIME_IMPORT)) {
        const spec = m[1] ?? m[2] ?? ''
        const target = resolve(file, spec)
        if (!target) continue
        if (!isPacked(target))
          missing.push(
            `${path.relative(pkgDir, target)} (imported by ${path.relative(pkgDir, file)})`,
          )
        if (/\.tsx?$/.test(target)) walk(target)
      }
    }
    for (const f of start) walk(f)
    expect(seen.size).toBeGreaterThan(50)
    expect(missing).toEqual([])
  })
})
