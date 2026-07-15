import { useEffect, useState } from 'react'
import { useCountUp } from '../hooks/useCountUp.js'
import { withAlpha } from '../lib/colorUtils.js'

// Animated circular score gauge for the results screen (lever 6).
// The arc sweeps in on mount and the number counts up to the total.
export default function ScoreRing({ value, max, color = '#172B5C', size = 132, stroke = 12 }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const pct = max ? Math.min(1, Math.max(0, value / max)) : 0

  // Start empty, then animate to the real offset just after mount.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setArmed(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const dashOffset = circumference * (1 - (armed ? pct : 0))

  const count = useCountUp(value)

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={withAlpha(color, 0.14)}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[34px] font-semibold leading-none text-black">
          {count}
        </span>
        {max ? <span className="mt-1 text-[12px] font-medium text-gray-400">of {max}</span> : null}
      </div>
    </div>
  )
}
