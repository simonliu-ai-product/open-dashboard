import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/node.ts',
    'src/jsx-runtime.ts',
    'src/jsx-dev-runtime.ts',
    'src/cli/bin.ts',
  ],
  format: 'esm',
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    'pg',
    /^mysql2/,
    'mssql',
    'oracledb',
    '@duckdb/node-api',
    '@clickhouse/client',
    '@google-cloud/bigquery',
    'snowflake-sdk',
    /^node:/,
    /^react/,
  ],
})
