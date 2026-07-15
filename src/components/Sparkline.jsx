import { withAlpha } from '../lib/colorUtils.js'

// A tiny trend chart of past assessment scores (lever 6). Renders nothing until
// there are at least two data points to connect.
export default function Sparkline({ values, max, color = '#172B5C', width = 260, height = 56 }) {
  if (!Array.isArray(values) || values.length < 2) return null

  const pad = 6
  const maxV = max || Math.max(...values, 1)
  const stepX = (width - pad * 2) / (values.length - 1)

  const pts = values.map((v, i) => {
    const x = pad + i * stepX
    const y = pad + (height - pad * 2) * (1 - Math.min(1, v / maxV))
    return [x, y]
  })

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${height - pad} L ${pts[0][0].toFixed(1)} ${height - pad} Z`
  const last = pts[pts.length - 1]

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={area} fill={withAlpha(color, 0.1)} />
      <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={3.5} fill={color} />
    </svg>
  )
}
