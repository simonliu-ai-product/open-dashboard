import type { QueryResult } from '../config.js'
import type { QueryAlertResult } from '../runtime/types.js'

export type AlertOperator = '>' | '>=' | '<' | '<=' | '==' | '!='

export interface AlertRule {
  raw: string
  column: string
  op: AlertOperator
  threshold: number
  message?: string
}

const RULE_RE = /^([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)(?:\s+(.*))?$/

export function parseAlertRule(raw: string): AlertRule | undefined {
  const match = RULE_RE.exec(raw.trim())
  if (!match) return undefined
  const column = match[1] as string
  const op = match[2] as AlertOperator
  const threshold = Number(match[3])
  if (!Number.isFinite(threshold)) return undefined
  const message = match[4]?.trim()
  return { raw: raw.trim(), column, op, threshold, ...(message ? { message } : {}) }
}

function compare(actual: number, op: AlertOperator, threshold: number): boolean {
  switch (op) {
    case '>':
      return actual > threshold
    case '>=':
      return actual >= threshold
    case '<':
      return actual < threshold
    case '<=':
      return actual <= threshold
    case '==':
      return actual === threshold
    case '!=':
      return actual !== threshold
  }
}

export function evaluateAlerts(
  result: QueryResult,
  rules: string[] | undefined,
): QueryAlertResult[] {
  if (!rules || rules.length === 0) return []
  const out: QueryAlertResult[] = []
  for (const raw of rules) {
    const parsed = parseAlertRule(raw)
    if (!parsed) continue
    const values = result.rows
      .map((row) => Number(row[parsed.column]))
      .filter((v) => Number.isFinite(v))
    const actual = values[0] ?? null
    const triggered = actual !== null && values.some((v) => compare(v, parsed.op, parsed.threshold))
    const hitValue =
      actual !== null
        ? (values.find((v) => compare(v, parsed.op, parsed.threshold)) ?? actual)
        : null
    out.push({
      rule: parsed.raw,
      column: parsed.column,
      op: parsed.op,
      threshold: parsed.threshold,
      actual: hitValue,
      triggered,
      ...(parsed.message ? { message: parsed.message } : {}),
    })
  }
  return out
}
