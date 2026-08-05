// Large circular countdown with a progress ring. Rendered over the player's
// photographic backdrop, so it is drawn in white/translucent tones.
function format(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function MeditationTimer({ remaining, progress, isRunning, size = 260 }) {
  const stroke = 8
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - progress)

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth={stroke}
        />
        {/* Elapsed */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[46px] font-extrabold tabular-nums leading-none text-white">
          {format(remaining)}
        </span>
        <span className="mt-2.5 text-[12px] font-bold uppercase tracking-[0.18em] text-white/75">
          {isRunning ? 'Breathe' : 'Ready'}
        </span>
      </div>
    </div>
  )
}
