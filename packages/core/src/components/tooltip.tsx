export interface TipRow {
  color?: string
  label: string
  value: string
}

/** The one tooltip every chart uses: a title and label/value rows, flipped to stay inside the plot. */
export function ChartTooltip(props: {
  left: number
  top: number
  width: number
  title: string
  rows: TipRow[]
}) {
  const flip = props.left > props.width / 2
  return (
    <div
      className="odd-tooltip"
      style={{
        top: props.top,
        left: flip ? undefined : props.left + 12,
        right: flip ? props.width - props.left + 12 : undefined,
      }}
    >
      <div className="odd-tooltip-title">{props.title}</div>
      {props.rows.map((row) => (
        <div className="odd-tooltip-row" key={row.label}>
          {row.color ? (
            <span className="odd-key odd-key-box" style={{ background: row.color }} />
          ) : (
            <span />
          )}
          <span className="odd-tooltip-label">{row.label}</span>
          <span className="odd-tooltip-value">{row.value}</span>
        </div>
      ))}
    </div>
  )
}
