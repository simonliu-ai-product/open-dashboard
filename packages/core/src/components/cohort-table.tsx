import { cohortMatrix } from '../runtime/cohort.js'
import { sequential } from '../runtime/color.js'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { humanize } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext } from './panel.js'

export interface CohortTableProps extends PanelProps {
  query: string
  /** The group a row started in — usually the sign-up month. */
  cohort: string
  /** Periods since the start: 0, 1, 2… */
  period: string
  /** How many in that cohort were active in that period. */
  value: string
  /** Show a share of the cohort's size (default) or the raw count. */
  mode?: 'percent' | 'count'
  /** The cohort's size. Default: its period-0 value. */
  size?: string
  format?: Format
}

/**
 * The retention triangle: a row per cohort, a column per period since it
 * began. Shading follows the share retained; period 0 is the cohort itself
 * and is left unshaded so it does not swamp the scale.
 */
function Triangle({ run, props }: { run: QueryRun; props: CohortTableProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const keys = {
    cohort: props.cohort,
    period: props.period,
    value: props.value,
    ...(props.size ? { size: props.size } : {}),
  }
  const { rows, periods } = cohortMatrix(run.result.rows, keys)
  if (rows.length === 0 || periods === 0) {
    return (
      <div className="odd-panel-message">
        {t('Needs cohort, period (0, 1, 2…) and value columns.')}
      </div>
    )
  }
  const mode = props.mode ?? 'percent'
  const share = (v: number | undefined, size: number) =>
    v === undefined || size <= 0 ? undefined : v / size
  const later = rows.flatMap((r) =>
    r.values.slice(1).map((v) => (mode === 'percent' ? share(v, r.size) : v)),
  )
  const max = Math.max(1e-9, ...later.filter((v): v is number => v !== undefined))

  return (
    <div className="odd-table-wrap">
      <table className="odd-table odd-cohort">
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left' }}>
              <span className="odd-cohort-head">{humanize(props.cohort)}</span>
            </th>
            <th scope="col">
              <span className="odd-cohort-head">{t('Size')}</span>
            </th>
            {Array.from({ length: periods }, (_, p) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: periods are positional
              <th key={p} scope="col">
                <span className="odd-cohort-head">{p}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.cohort}
              className={drill ? 'odd-drillable' : undefined}
              data-active={drill?.isActive(row.cohort) || undefined}
              tabIndex={drill ? 0 : undefined}
              onClick={drill ? () => drill.pick(row.cohort) : undefined}
              onKeyDown={
                drill
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        drill.pick(row.cohort)
                      }
                    }
                  : undefined
              }
            >
              <th scope="row" className="odd-cohort-name">
                {formatValue(row.cohort, undefined, ctx)}
              </th>
              <td data-numeric>{formatValue(row.size, 'integer', ctx)}</td>
              {row.values.map((v, p) => {
                const shown = mode === 'percent' ? share(v, row.size) : v
                if (shown === undefined) {
                  // biome-ignore lint/suspicious/noArrayIndexKey: periods are positional
                  return <td key={p} className="odd-cohort-empty" />
                }
                const level = p === 0 ? 0 : shown / max
                return (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: periods are positional
                    key={p}
                    data-numeric
                    className="odd-cohort-cell"
                    data-strong={level > 0.55 || undefined}
                    style={p === 0 ? undefined : { background: sequential(level) }}
                    title={`${formatValue(row.cohort, undefined, ctx)}, ${t('period {n}', { n: p })}: ${formatValue(v, props.format ?? 'integer', ctx)}`}
                  >
                    {mode === 'percent'
                      ? formatValue(shown, 'percent', ctx)
                      : formatValue(shown, props.format ?? 'integer', ctx)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Retention by cohort: of those who started in a period, how many are still here N periods on. */
function CohortTablePanel(props: CohortTableProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="CohortTable" state={state} defaultHeight={360}>
      {(run) => <Triangle run={run} props={props} />}
    </PanelFrame>
  )
}

export const CohortTable = editable('CohortTable', CohortTablePanel)
