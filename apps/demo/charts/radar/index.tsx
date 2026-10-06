import { defineChart } from '@open-dashboard/core'

interface RadarProps {
  /** One spoke per distinct value. */
  axis: string
  value: string
  /** Optional: one outline per distinct value. */
  series?: string
}

export default defineChart<RadarProps>({
  name: 'Radar',
  columns: ['axis', 'value', 'series'],
  sample: { query: 'sample', props: { axis: 'category', value: 'revenue', series: 'period' } },
  height: 340,
  render: ({ rows, props, width, height, color, format }) => {
    const axes = [...new Set(rows.map((row) => String(row[props.axis])))]
    const groups = props.series
      ? [...new Set(rows.map((row) => String(row[props.series as string])))]
      : ['']
    const max = Math.max(0, ...rows.map((row) => Number(row[props.value]) || 0)) || 1
    const legend = props.series ? 22 : 0
    const cx = width / 2
    const cy = legend + (height - legend) / 2
    const radius = Math.max(0, Math.min(width / 2 - 70, (height - legend) / 2 - 24))
    const point = (i: number, t: number): [number, number] => {
      const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2
      return [cx + Math.cos(angle) * radius * t, cy + Math.sin(angle) * radius * t]
    }
    const rings = [0.25, 0.5, 0.75, 1]
    return (
      <svg width={width} height={height} role="img" aria-label={props.title}>
        {props.series
          ? groups.map((group, g) => (
              <g key={group} transform={`translate(${g * 96}, 0)`}>
                <rect x={0} y={4} width={10} height={10} rx={2} fill={color(g)} />
                <text x={16} y={13} fontSize={12} fill="var(--odd-ink-2)">
                  {group}
                </text>
              </g>
            ))
          : null}
        {rings.map((t) => (
          <polygon
            key={t}
            points={axes.map((_, i) => point(i, t).join(',')).join(' ')}
            fill="none"
            stroke="var(--odd-grid)"
          />
        ))}
        {axes.map((axis, i) => {
          const [x, y] = point(i, 1)
          const [lx, ly] = point(i, 1.12)
          return (
            <g key={axis}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--odd-grid)" />
              <text
                x={lx}
                y={ly}
                fontSize={11.5}
                fill="var(--odd-ink-2)"
                textAnchor={Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end'}
                dominantBaseline="middle"
              >
                {axis}
              </text>
            </g>
          )
        })}
        <text x={cx + 6} y={cy - radius + 12} fontSize={10.5} fill="var(--odd-tick)">
          {format(max, 'currencyCompact')}
        </text>
        {groups.map((group, g) => {
          const values = axes.map((axis) => {
            const row = rows.find(
              (r) =>
                String(r[props.axis]) === axis &&
                (!props.series || String(r[props.series]) === group),
            )
            return (Number(row?.[props.value]) || 0) / max
          })
          return (
            <g key={group}>
              <polygon
                points={values.map((t, i) => point(i, t).join(',')).join(' ')}
                fill={color(g)}
                fillOpacity={0.14}
                stroke={color(g)}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {values.map((t, i) => {
                const [x, y] = point(i, t)
                return <circle key={axes[i]} cx={x} cy={y} r={3} fill={color(g)} />
              })}
            </g>
          )
        })}
      </svg>
    )
  },
})
