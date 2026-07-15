import { withAlpha } from '../lib/colorUtils.js'

// A selectable 30-day programme card shown on the journey selection screen.
export default function JourneyCard({ journey, onStart }) {
  const color = journey.color || '#172B5C'
  const dayCount =
    journey.duration_days ?? (Array.isArray(journey.days) ? journey.days.length : 30)

  return (
    <div className="overflow-hidden rounded-card bg-white shadow-card">
      {/* Top colour stripe */}
      <span aria-hidden className="block h-1.5 w-full" style={{ backgroundColor: color }} />
      {/* Soft colour glow fading into white */}
      <div
        className="p-5"
        style={{ background: `linear-gradient(180deg, ${withAlpha(color, 0.1)} 0%, #fff 42%)` }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
          {dayCount}-day programme
        </p>
        <h3 className="mt-1 font-display text-[19px] font-semibold leading-snug text-black">
          {journey.title}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500">{journey.description}</p>

        {/* 44px min-height ensures comfortable touch target */}
        <button
          type="button"
          onClick={() => onStart(journey.id)}
          className="mt-4 min-h-[44px] w-full rounded-btn text-[14px] font-semibold text-white
                     transition-transform duration-100 active:scale-[0.97]"
          style={{ backgroundColor: color }}
        >
          Start journey
        </button>
      </div>
    </div>
  )
}
