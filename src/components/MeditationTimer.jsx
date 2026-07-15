// Large circular countdown with an animated progress ring.
function format(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function MeditationTimer({ remaining, progress, isRunning }) {
  const size = 260
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - progress)

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      {/* Soft glow behind the ring */}
      <div
        aria-hidden
        className="absolute inset-4 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(76,176,63,0.14) 0%, rgba(76,176,63,0) 70%)' }}
      />
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4CB03F" />
            <stop offset="100%" stopColor="#172B5C" />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#EEF0F4"
          strokeWidth={stroke}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={['transition-[stroke-dashoffset] duration-1000 ease-linear', isRunning ? 'animate-ring' : ''].join(' ')}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-[52px] font-semibold tabular-nums leading-none text-black">
          {format(remaining)}
        </span>
        <span className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-400">
          {isRunning ? 'Breathe' : 'Ready'}
        </span>
      </div>
    </div>
  )
}
