import CoverImage from './CoverImage.jsx'
import Pill from './Pill.jsx'
import { CalendarIcon, ChevronRightIcon } from './Icons.jsx'

// Journey selection card: a portrait cover on the left, copy on the right, and
// a chevron affordance. Journeys without a cover still lay out correctly — the
// thumbnail falls back to the neutral media tint.
export default function JourneyCard({ journey, onStart }) {
  const dayCount =
    journey.duration_days ?? (Array.isArray(journey.days) ? journey.days.length : 30)

  return (
    <button
      type="button"
      onClick={() => onStart(journey.id)}
      className="card-press flex w-full overflow-hidden rounded-card bg-white text-left shadow-card"
    >
      <CoverImage
        src={journey.cover}
        className="w-[104px] shrink-0 self-stretch sm:w-[124px]"
        alt=""
      />

      <div className="flex min-w-0 flex-1 items-center gap-2 px-4 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[18px] font-extrabold leading-snug text-navy">
            {journey.title}
          </h3>
          {/* Clamped so cards keep an even rhythm regardless of copy length. */}
          <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-slate-500">
            {journey.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-slate-500">
              <CalendarIcon className="h-4 w-4" strokeWidth={2} />
              {dayCount} Days
            </span>
            {journey.category ? <Pill label={journey.category} /> : null}
          </div>
        </div>

        <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-400" />
      </div>
    </button>
  )
}
