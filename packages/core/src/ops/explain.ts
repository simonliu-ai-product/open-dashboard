import type { ParamValue, QueryResult } from '../config.js'
import type { Workspace } from '../workspace.js'
import { combineResults } from './combine.js'
import { dashboardQueries, runDashboardQuery } from './dashboards.js'
import { OpsError } from './errors.js'

export interface QueryPlan {
  query: string
  source: string
  elapsedMs: number
  steps: string[]
  usesIndex: boolean
  fullScan: boolean
}

function formatPlanRows(result: QueryResult): string[] {
  if (result.rows.length === 0) return []
  return result.rows.map((row) => {
    if ('detail' in row && typeof row.detail === 'string') {
      return row.detail
    }
    const vals = result.columns
      .map((c) => row[c.name])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(String)
    return vals.join(' · ')
  })
}

/**
 * Explains a named dashboard query — the browser still only sends the dashboard
 * id, query name and bound params, never SQL.
 */
export async function explainDashboardQuery(
  workspace: Workspace,
  id: string,
  name: string,
  params: Record<string, ParamValue> = {},
): Promise<QueryPlan> {
  const queries = dashboardQueries(workspace.config, id)
  const query = queries.get(name)
  if (!query) {
    throw new OpsError(`dashboard "${id}" has no query "${name}"`, 404)
  }

  if (query.uses?.length) {
    const inputs = new Map<string, QueryResult>()
    const runs = await Promise.all(
      query.uses.map((used) => runDashboardQuery(workspace, id, used, params)),
    )
    for (const [i, used] of query.uses.entries()) {
      const r = runs[i]
      if (r) inputs.set(used, r.result)
    }
    const result = await combineResults(
      `EXPLAIN QUERY PLAN ${query.sql}`,
      inputs,
      params,
      workspace.config.maxRows,
    )
    const steps = formatPlanRows(result)
    const joined = steps.join('\n')
    return {
      query: name,
      source: 'combined',
      elapsedMs: result.elapsedMs,
      steps,
      usesIndex: /USING\s+(?:COVERING\s+)?INDEX/i.test(joined),
      fullScan: /\bSCAN\b/i.test(joined) && !/USING\s+(?:COVERING\s+)?INDEX/i.test(joined),
    }
  }

  const sourceName = workspace.sourceName(query.source)
  const sourceCfg = workspace.config.datasources[sourceName]
  const datasource = await workspace.source(sourceName)
  const sqliteLike =
    !sourceCfg ||
    sourceCfg.type === 'sqlite' ||
    sourceCfg.type === 'csv' ||
    sourceCfg.type === 'json' ||
    sourceCfg.type === 'http' ||
    sourceCfg.type === 'mcp'

  const explainSql = sqliteLike ? `EXPLAIN QUERY PLAN ${query.sql}` : `EXPLAIN ${query.sql}`
  const result = await datasource.query(explainSql, params, {
    maxRows: workspace.config.maxRows,
    timeoutMs: workspace.config.timeoutMs,
  })
  const steps = formatPlanRows(result)
  const joined = steps.join('\n')
  return {
    query: name,
    source: sourceName,
    elapsedMs: result.elapsedMs,
    steps,
    usesIndex: /INDEX/i.test(joined),
    fullScan:
      /\b(?:SCAN|Seq Scan|ALL)\b/i.test(joined) && !/USING\s+(?:COVERING\s+)?INDEX/i.test(joined),
  }
}
