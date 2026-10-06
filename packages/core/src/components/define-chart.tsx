import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { ColumnInfo, Row } from '../config.js'
import { seriesColor } from '../runtime/color.js'
import { applyProps } from '../runtime/convert.js'
import { usePanelEdit } from '../runtime/edit.js'
import { formatValue } from '../runtime/format.js'
import { useT } from '../runtime/i18n.js'
import type { Format, QueryRun } from '../runtime/types.js'
import { useQuery } from '../runtime/use-query.js'
import { PanelFrame, type PanelProps, useFormatContext, useSize } from './panel.js'

export interface ChartContext<P> {
  run: QueryRun
  rows: Row[]
  columns: ColumnInfo[]
  /** The props the dashboard passed, title and query included. */
  props: P
  /** The plot's size in px — draw to it. */
  width: number
  height: number
  /** The i-th categorical colour of the dashboard's theme (0-based). */
  color: (index: number) => string
  /** A value as the dashboard formats numbers, in its locale and currency. */
  format: (value: unknown, format?: Format) => string
}

export interface ChartDefinition<P> {
  /** Shown in the inspector and on the Custom charts page. */
  name: string
  /** Props whose value is a result column name: `check` verifies each against the query. */
  columns?: readonly (keyof P & string)[]
  /** What the Custom charts page previews: a query in this folder's `.sql` files, and props for it. */
  sample?: { query: string; props?: Partial<P> }
  /** Panel height when the row sets none. Default 300. */
  height?: number
  render: (chart: ChartContext<CustomChartProps<P>>) => ReactNode
}

export type CustomChartProps<P> = PanelProps & { query: string } & P

class ChartBoundary extends Component<
  { children: ReactNode; message: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[open-dashboard]', error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="odd-panel-message odd-panel-error" role="alert">
        <strong>{this.props.message}</strong>
        <code>{this.state.error.message}</code>
      </div>
    )
  }
}

/** `render` is called here, inside the boundary, so a chart that throws fails alone. */
function Draw<P>({
  definition,
  chart,
}: {
  definition: ChartDefinition<P>
  chart: ChartContext<CustomChartProps<P>>
}) {
  return <>{definition.render(chart)}</>
}

function Plot<P>({
  run,
  props,
  definition,
}: {
  run: QueryRun
  props: CustomChartProps<P>
  definition: ChartDefinition<P>
}) {
  const t = useT()
  const [ref, size] = useSize<HTMLDivElement>()
  const ctx = useFormatContext()
  return (
    <div className="odd-plot odd-custom-plot" ref={ref}>
      {size.width > 0 && size.height > 0 ? (
        <ChartBoundary message={t('This chart failed to draw')}>
          <Draw
            definition={definition}
            chart={{
              run,
              rows: run.result.rows,
              columns: run.result.columns,
              props,
              width: size.width,
              height: size.height,
              color: seriesColor,
              format: (value, format) => formatValue(value, format, ctx),
            }}
          />
        </ChartBoundary>
      ) : null}
    </div>
  )
}

/**
 * A chart of your own, used in a dashboard like a built-in panel. The frame —
 * loading and error states, the inspector, notes for the agent, download, the
 * dashboard's theme — comes with it; `render` only draws the data.
 */
export function defineChart<P extends object = Record<string, unknown>>(
  definition: ChartDefinition<P>,
) {
  function CustomChart(source: CustomChartProps<P>) {
    // Like editable() for built-ins: Edit mode's staged size and settings show
    // before Save. A custom chart cannot change type, so only props apply.
    const edit = usePanelEdit(source.title)
    const props = edit
      ? (applyProps(source as Record<string, unknown>, edit.changes) as CustomChartProps<P>)
      : source
    const state = useQuery(props.query)
    return (
      <PanelFrame
        {...props}
        component={definition.name}
        state={state}
        defaultHeight={definition.height ?? 300}
      >
        {(run) => <Plot run={run} props={props} definition={definition} />}
      </PanelFrame>
    )
  }
  CustomChart.displayName = definition.name
  CustomChart.chart = definition
  return CustomChart
}
