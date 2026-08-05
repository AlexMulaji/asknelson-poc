import CoverImage from './CoverImage.jsx'

// The active journey's "today" card: the journey cover as a dark photographic
// banner, with the day's task and the primary call to action.
export default function JourneyHero({ journey, day, onStart, finished, dayCount }) {
  const cover = journey?.cover_hero || journey?.cover

  return (
    <div className="relative overflow-hidden rounded-hero bg-navy">
      <CoverImage src={cover} className="absolute inset-0 h-full w-full" />
      {/* Copy sits on the left, so the wash is heaviest there and opens up over
          the photograph on the right. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgba(1,36,59,0.96) 0%, rgba(1,36,59,0.88) 42%, rgba(1,36,59,0.45) 100%)',
        }}
      />

      <div className="relative px-5 py-6 lg:px-8 lg:py-9">
        {finished ? (
          <>
            <p className="font-display text-[22px] font-extrabold leading-snug text-white lg:text-[28px]">
              You did it — all {dayCount} days.
            </p>
            <p className="mt-2 max-w-md text-[14px] leading-relaxed text-white/80">
              That's real commitment to yourself. Take a moment to feel good about it.
            </p>
          </>
        ) : day ? (
          <>
            <p className="text-[13px] font-extrabold text-brand">Day {day.day}</p>
            <h2 className="mt-1 max-w-lg font-display text-[21px] font-extrabold leading-snug text-white lg:text-[30px]">
              {day.title}
            </h2>
            <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-white/80">{day.task}</p>
            <button
              type="button"
              onClick={() => onStart?.(day)}
              className="mt-5 grid min-h-[48px] w-full place-items-center rounded-btn bg-brand px-8 text-[15px] font-extrabold text-white transition hover:bg-brand-dark active:scale-[0.98] lg:w-auto lg:min-w-[240px]"
            >
              Start Todays Activity
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
