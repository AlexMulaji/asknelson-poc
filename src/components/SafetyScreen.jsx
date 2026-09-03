import { useNavigate } from 'react-router-dom'
import { AlertIcon } from './Icons.jsx'
import { useJourneyProgress } from '../hooks/useJourneyProgress.js'
import { runCta } from '../lib/assessmentCta.js'

// HARD SAFETY GATE.
// When a safety item is triggered (e.g. PHQ-9 q9 > 0), this screen is shown
// FIRST and INSTEAD OF the normal band result — regardless of total score.
// There is no path here that reveals the band; the only actions are to reach
// out for support or to leave. This is intentionally not skippable.
export default function SafetyScreen({ safety, onExit }) {
  const navigate = useNavigate()
  const { switchJourney } = useJourneyProgress()

  if (!safety) return null

  return (
    <div className="space-y-5">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-pill-red text-danger">
        <AlertIcon className="h-7 w-7" />
      </div>

      <div>
        <h2 className="font-display text-[26px] font-extrabold leading-tight text-navy">
          {safety.headline}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{safety.body}</p>
      </div>

      {/* Primary action — reach out now */}
      <button
        type="button"
        onClick={() => runCta(safety.cta, { navigate, switchJourney })}
        className="flex min-h-[56px] w-full items-center justify-center rounded-btn bg-danger px-5
                   text-[15px] font-extrabold text-white transition active:scale-[0.98]"
      >
        {safety.cta?.label || 'Talk to someone now'}
      </button>

      {/* A quiet way out — but the band result is never shown from here. */}
      <button
        type="button"
        onClick={onExit}
        className="min-h-[44px] w-full text-[14px] font-bold text-slate-400 hover:text-slate-600"
      >
        Back to assessments
      </button>
    </div>
  )
}
