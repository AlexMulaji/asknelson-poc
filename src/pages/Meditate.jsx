import PageHeader from '../components/PageHeader.jsx'
import MeditationTimer from '../components/MeditationTimer.jsx'
import SoundScene from '../components/SoundScene.jsx'
import { PlayIcon, PauseIcon, StopIcon } from '../components/Icons.jsx'
import { useMeditation, DURATIONS, SOUNDS } from '../hooks/useMeditation.js'

export default function Meditate() {
  const m = useMeditation()

  return (
    <div className="page-enter">
      <PageHeader title="Meditate" subtitle="Take a moment for yourself" />

      <div className="px-5 pt-4 pb-6 space-y-5 lg:mx-auto lg:max-w-2xl lg:pt-8">
        {/* Animated scene reflecting the chosen sound */}
        <SoundScene sound={m.sound} isRunning={m.isRunning} />

        {/* Duration selector */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Duration
          </p>
          <div className="flex gap-2">
            {DURATIONS.map((d) => {
              const isActive = d === m.durationMin
              return (
                <button
                  key={d}
                  type="button"
                  disabled={m.isRunning}
                  onClick={() => m.setDurationMin(d)}
                  className={[
                    'flex-1 min-h-[40px] rounded-full border text-[13px] font-medium',
                    'transition-colors duration-150 disabled:opacity-40',
                    isActive
                      ? 'border-brand bg-brand text-white'
                      : 'border-gray-200 bg-white text-gray-600 active:bg-gray-50',
                  ].join(' ')}
                >
                  {d} min
                </button>
              )
            })}
          </div>
        </div>

        {/* Sound selector */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Sound
          </p>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {SOUNDS.map((s) => {
              const isActive = s.id === m.sound
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => m.setSound(s.id)}
                  className={[
                    'h-9 whitespace-nowrap rounded-full border px-4 text-[13px] font-medium',
                    'transition-colors duration-150',
                    isActive
                      ? 'border-brand bg-brand text-white'
                      : 'border-gray-200 bg-white text-gray-600 active:bg-gray-50',
                  ].join(' ')}
                >
                  {s.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Timer — centred, with a touch of vertical breathing room */}
        <div className="flex justify-center py-4">
          <MeditationTimer
            remaining={m.remaining}
            progress={m.progress}
            isRunning={m.isRunning}
          />
        </div>

        {/* Controls — stop · play/pause (stop is a ghost button to de-emphasise) */}
        <div className="flex items-center justify-center gap-6">
          <button
            type="button"
            onClick={m.stop}
            aria-label="Stop and reset"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-gray-200
                       text-gray-400 transition-transform duration-100 active:scale-90"
          >
            <StopIcon className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={m.isRunning ? m.pause : m.start}
            aria-label={m.isRunning ? 'Pause' : 'Play'}
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-brand
                       text-white shadow-lg transition-transform duration-100 active:scale-90"
          >
            {m.isRunning ? (
              <PauseIcon className="h-7 w-7" />
            ) : (
              <PlayIcon className="h-7 w-7" />
            )}
          </button>

          {/* Visual spacer to keep play centred */}
          <span className="h-12 w-12" aria-hidden />
        </div>
      </div>

      {/* Completion full-screen overlay */}
      {m.isComplete ? (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white px-8"
          // Ensure safe areas on iOS are respected inside the overlay.
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[#4CB03F]/10">
              <span className="text-3xl" role="img" aria-label="leaf">🌿</span>
            </div>
            <h2 className="font-display text-[30px] font-semibold text-black">Well done.</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-gray-500">
              Take a breath before you move on.
            </p>
            <button
              type="button"
              onClick={m.dismissComplete}
              className="mt-10 min-h-[48px] rounded-btn bg-brand px-10 text-[14px] font-semibold text-white
                         transition-transform duration-100 active:scale-[0.97]"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
