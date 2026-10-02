import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import { pickX, pickY } from '../runtime/shape.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { useDrill } from './drill.js'
import { editable } from './editable.js'
import { PanelFrame, type PanelProps, useFormatContext } from './panel.js'

export interface FunnelChartProps extends PanelProps {
  query: string
  /** The stage names, in order — order the rows in SQL. Default: first text column. */
  label?: string
  /** How many reached each stage. Default: first numeric column. */
  value?: string
  format?: Format
}

/**
 * Stages as bars on one scale, each with its share of the first stage, and the
 * step-to-step conversion between them — the number a funnel is read for.
 */
function Funnel({ run, props }: { run: QueryRun; props: FunnelChartProps }) {
  const ctx = useFormatContext()
  const t = useT()
  const drill = useDrill(props.drill)
  const { columns, rows } = run.result
  const label = pickX(columns, props.label)
  const value = pickY(columns, label, props.value)[0]
  if (!label || !value)
    return (
      <div className="odd-panel-message">
        {t('Needs a label column and a numeric value column.')}
      </div>
    )
  const stages = rows
    .map((row) => ({ name: row[label], n: Number(row[value]) }))
    .filter((s) => Number.isFinite(s.n))
  const top = Math.max(stages[0]?.n ?? 0, 1e-9)

  return (
    <ol className="odd-funnel">
      {stages.map((stage, i) => {
        const previous = stages[i - 1]
        const step = previous && previous.n > 0 ? stage.n / previous.n : undefined
        const share = stage.n / top
        const active = drill?.isActive(stage.name)
        return (
          <li key={String(stage.name)} data-dim={drill?.anyActive && !active ? '' : undefined}>
            {step !== undefined ? (
              <span className="odd-funnel-step">
                {t('{pct} continue', { pct: formatValue(step, 'percent', ctx) })}
              </span>
            ) : null}
            <button
              type="button"
              className="odd-funnel-row"
              disabled={!drill}
              aria-pressed={drill ? Boolean(active) : undefined}
              onClick={drill ? () => drill.pick(stage.name) : undefined}
            >
              <span className="odd-funnel-label">{formatValue(stage.name, 'text', ctx)}</span>
              <span className="odd-funnel-track">
                <span
                  className="odd-funnel-bar"
                  style={{ width: `${Math.max(0.5, share * 100)}%` }}
                />
              </span>
              <span className="odd-funnel-value">{formatValue(stage.n, props.format, ctx)}</span>
              <span className="odd-funnel-share">{formatValue(share, 'percent', ctx)}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Drop-off between ordered stages: visit → sign-up → first order → repeat. */
function FunnelChartPanel(props: FunnelChartProps) {
  const state = useQuery(props.query)
  return (
    <PanelFrame {...props} component="FunnelChart" state={state} defaultHeight={300}>
      {(run) => <Funnel run={run} props={props} />}
    </PanelFrame>
  )
}

export const FunnelChart = editable('FunnelChart', FunnelChartPanel)
