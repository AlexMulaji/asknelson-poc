import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import CoverImage from './CoverImage.jsx'
import MeditationTimer from './MeditationTimer.jsx'
import {
  CloseIcon,
  PauseIcon,
  PlayIcon,
  RestartIcon,
  StopIcon,
  VolumeIcon,
  VolumeMaxIcon,
} from './Icons.jsx'
import { soundById } from '../hooks/useMeditation.js'

// Full-screen meditation session: the chosen soundscape fills the background,
// with the ring timer, transport controls and a volume slider over it.
export default function MeditationPlayer({ m, onClose }) {
  const scene = soundById(m.sound)

  // Escape closes the session, matching the ✕ affordance.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The player is a takeover — stop the page behind it from scrolling.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const ghostBtn =
    'grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm transition hover:bg-white/25 active:scale-90'

  // Portalled to <body>: the page wrapper keeps a `transform` from the
  // .page-enter animation (fill-mode: both), which would otherwise become the
  // containing block for this fixed overlay and stop it covering the viewport.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Meditation session"
      className="fixed inset-0 z-[60] overflow-hidden bg-navy"
    >
      <CoverImage src={scene.image} priority width={16} height={9} className="absolute inset-0 h-full w-full" />
      <div aria-hidden className="absolute inset-0 bg-navy/70" />

      <div
        className="relative flex h-full flex-col px-6"
        style={{
          paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))',
          paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="End session"
            className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/15"
          >
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="mt-2 max-w-md">
          <h2 className="font-display text-[28px] font-extrabold leading-tight text-white">
            Time to Meditate
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-white/80">
            Take a moment to pause, breathe, and recharge during your meditation session
          </p>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <MeditationTimer
            remaining={m.remaining}
            progress={m.progress}
            isRunning={m.isRunning}
          />
        </div>

        <div className="mx-auto w-full max-w-sm">
          <div className="flex items-center justify-center gap-7">
            <button type="button" onClick={m.stop} aria-label="Stop" className={ghostBtn}>
              <StopIcon className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={m.isRunning ? m.pause : m.start}
              aria-label={m.isRunning ? 'Pause' : 'Play'}
              className="grid h-[72px] w-[72px] place-items-center rounded-full bg-surface text-ink shadow-lift transition active:scale-90"
            >
              {m.isRunning ? (
                <PauseIcon className="h-7 w-7" />
              ) : (
                <PlayIcon className="ml-0.5 h-7 w-7" />
              )}
            </button>

            <button
              type="button"
              onClick={m.stop}
              aria-label="Restart"
              className={ghostBtn}
            >
              <RestartIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-8 flex items-center gap-3">
            <VolumeIcon className="h-5 w-5 shrink-0 text-white/80" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={m.volume}
              aria-label="Volume"
              onChange={(e) => m.setVolume(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/30 accent-white
                         [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                         [&::-webkit-slider-thumb]:bg-surface"
            />
            <VolumeMaxIcon className="h-5 w-5 shrink-0 text-white/80" />
          </div>
        </div>
      </div>

      {/* Session complete */}
      {m.isComplete ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-navy/85 px-8 backdrop-blur-sm">
          <div className="text-center">
            <h2 className="font-display text-[30px] font-extrabold text-white">Well done.</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-white/80">
              Take a breath before you move on.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-8 min-h-[48px] rounded-btn bg-brand px-10 text-[15px] font-extrabold text-on-brand transition hover:bg-brand-dark active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>,
    document.body
  )
}
