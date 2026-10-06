import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: 'esm',
  platform: 'node',
  // Plain .js / .d.ts, the names the exports map points at.
  fixedExtension: false,
  clean: true,
  dts: true,
  external: [/^@open-dashboard\/core/, /^node:/],
})
