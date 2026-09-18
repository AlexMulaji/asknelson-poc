import { useState } from 'react'
import CoverImage from '../components/CoverImage.jsx'
import MeditationPlayer from '../components/MeditationPlayer.jsx'
import { CheckIcon } from '../components/Icons.jsx'
import { useMeditation, DURATIONS, SOUNDS } from '../hooks/useMeditation.js'

// The "Meditation" tab of My Wellness: pick a soundscape and a length, then
// hand off to the full-screen player.
export default function Meditate() {
  const m = useMeditation()
  const [playing, setPlaying] = useState(false)

  const begin = () => {
    setPlaying(true)
    m.start()
  }

  const close = () => {
    m.stop()
    setPlaying(false)
  }

  return (
    <div className="pt-6">
      <h2 className="font-display text-[22px] font-extrabold text-ink lg:text-[26px]">
        Start Meditating
      </h2>
      <p className="mt-1 text-[14px] text-slate-500">Take a moment for yourself to meditate</p>

      {/* ── Soundscape ───────────────────────────────────────────────────── */}
      <section className="mt-7">
        <h3 className="font-display text-[17px] font-extrabold text-ink lg:text-[19px]">
          Select Your Meditation Sound
        </h3>
        <div className="no-scrollbar -mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1 lg:mx-0 lg:grid lg:grid-cols-5 lg:px-0">
          {SOUNDS.map((s) => {
            const active = s.id === m.sound
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => m.setSound(s.id)}
                aria-pressed={active}
                className="w-[84px] shrink-0 lg:w-auto"
              >
                <span
                  className={[
                    'relative block overflow-hidden rounded-card transition',
                    active ? 'ring-[3px] ring-brand' : 'ring-1 ring-line',
                  ].join(' ')}
                >
                  <CoverImage src={s.image} alt="" className="h-[118px] w-full lg:h-[140px]" />
                  {active ? (
                    <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-brand text-on-brand">
                      <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                  ) : null}
                </span>
                <span
                  className={[
                    'mt-2 block text-center text-[12px]',
                    active ? 'font-extrabold text-ink' : 'font-bold text-slate-500',
                  ].join(' ')}
                >
                  {s.label}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Duration ─────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h3 className="font-display text-[17px] font-extrabold text-ink lg:text-[19px]">
          Select Your Meditation Duration
        </h3>
        {/* Five options have to fit one row at 390px — hence the tight sizing. */}
        <div className="mt-3 flex gap-2.5 sm:gap-3">
          {DURATIONS.map((d) => {
            const active = d === m.durationMin
            return (
              <button
                key={d}
                type="button"
                onClick={() => m.setDurationMin(d)}
                aria-pressed={active}
                className={[
                  'grid aspect-square w-full max-w-[64px] shrink place-items-center rounded-full border-2 transition',
                  active
                    ? 'border-brand bg-brand-wash text-brand'
                    : 'border-line bg-surface text-ink hover:border-slate-300',
                ].join(' ')}
              >
                <span className="text-center leading-none">
                  <span className="block text-[18px] font-extrabold">{d}</span>
                  <span className="mt-0.5 block text-[10px] font-bold opacity-70">min</span>
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <button
        type="button"
        onClick={begin}
        className="mt-10 grid min-h-[52px] w-full place-items-center rounded-btn bg-brand text-[15px] font-extrabold text-on-brand transition hover:bg-brand-dark active:scale-[0.99] lg:max-w-[420px]"
      >
        Start Meditating
      </button>

      {playing ? <MeditationPlayer m={m} onClose={close} /> : null}
    </div>
  )
}
