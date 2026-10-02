import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const core = fileURLToPath(new URL('./packages/core/src', import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@open-dashboard\/core\/node$/, replacement: `${core}/node.ts` },
      { find: /^@open-dashboard\/core$/, replacement: `${core}/index.ts` },
    ],
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    globals: true,
    include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
})
