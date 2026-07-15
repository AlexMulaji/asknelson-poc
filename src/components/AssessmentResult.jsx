import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import SafetyScreen from './SafetyScreen.jsx'
import ScoreRing from './ScoreRing.jsx'
import Sparkline from './Sparkline.jsx'
import { useJourneyProgress } from '../hooks/useJourneyProgress.js'
import { runCta } from '../lib/assessmentCta.js'
import { meshGradient } from '../lib/colorUtils.js'
import { listContainer, listItem } from '../lib/motion.js'

// Results screen. Order of precedence:
//   1. Safety gate (if triggered) — shown FIRST and instead of the band.
//   2. Otherwise: an animated score, the matching band's headline/body, any
//      dimension flags, an optional safety_note, a trend, and the CTA.
//
// All copy is screening language drawn from JSON — we never state the user
// "has" a condition.
export default function AssessmentResult({ assessment, result, history, onRetake, onExit }) {
  const navigate = useNavigate()
  const { switchJourney } = useJourneyProgress()
  const color = assessment.color || '#172B5C'
  const scoreMax = assessment.scoring?.max

  // --- 1. HARD SAFETY GATE --------------------------------------------------
  if (result.safetyTriggered) {
    return <SafetyScreen safety={result.safety} onExit={onExit} />
  }

  const band = result.band
  const hasDimensions = result.dimensions && result.dimensions.length > 0
  const trendValues = Array.isArray(history) ? history.map((h) => h.score) : []
  const showTrend = trendValues.length >= 2

  return (
    <motion.div className="space-y-5" variants={listContainer} initial="hidden" animate="show">
      {/* Hero: animated score + band headline */}
      <motion.div
        variants={listItem}
        className="rounded-hero p-6 text-center"
        style={{ background: meshGradient(color) }}
      >
        <ScoreRing value={result.total} max={scoreMax} color={color} />
        <p
          className="mt-4 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color }}
        >
          {band?.band ?? 'Your result'}
        </p>
        <h2 className="mt-1 font-display text-[24px] font-semibold leading-tight text-black">
          {band?.headline ?? 'Thanks for checking in'}
        </h2>
        {band?.body ? (
          <p className="mx-auto mt-2 max-w-prose text-[15px] leading-relaxed text-gray-700">
            {band.body}
          </p>
        ) : null}
      </motion.div>

      {/* Screening reminder — never a diagnosis */}
      <motion.p variants={listItem} className="text-[12px] leading-relaxed text-gray-400">
        This is a screening tool to help you reflect, not a diagnosis. Your answers stay on this
        device.
      </motion.p>

      {/* Trend over time (from saved history) */}
      {showTrend ? (
        <motion.div variants={listItem} className="rounded-card bg-white p-5 shadow-card">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Your trend
            </p>
            <span className="text-[12px] text-gray-400">{trendValues.length} check-ins</span>
          </div>
          <div className="mt-3">
            <Sparkline values={trendValues} max={scoreMax} color={color} />
          </div>
        </motion.div>
      ) : null}

      {/* Dimension breakdown (e.g. burnout) + flags */}
      {hasDimensions ? (
        <motion.div variants={listItem} className="rounded-card bg-white p-5 shadow-card">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            What's driving it
          </p>
          <div className="mt-3 space-y-4">
            {result.dimensions.map((dim) => {
              const pct = dim.max ? Math.round((dim.subtotal / dim.max) * 100) : 0
              return (
                <div key={dim.id}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-semibold text-black">{dim.label}</span>
                    <span className="text-gray-400">
                      {dim.subtotal}/{dim.max}
                      {dim.flagged ? (
                        <span className="ml-2 font-semibold" style={{ color }}>
                          High
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ backgroundColor: color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, ease: 'easeOut', delay: 0.2 }}
                    />
                  </div>
                  {dim.flagged && dim.note ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">{dim.note}</p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </motion.div>
      ) : null}

      {/* Optional safety note attached to a band (e.g. relationship struggling) */}
      {band?.safety_note ? (
        <motion.div variants={listItem} className="rounded-card border border-amber-200 bg-amber-50 p-4">
          <p className="text-[13px] leading-relaxed text-amber-900">{band.safety_note}</p>
        </motion.div>
      ) : null}

      {/* Primary CTA */}
      {band?.cta ? (
        <motion.button
          variants={listItem}
          type="button"
          onClick={() => runCta(band.cta, { navigate, switchJourney })}
          className="min-h-[52px] w-full rounded-btn text-[15px] font-semibold text-white
                     transition-transform duration-100 active:scale-[0.98]"
          style={{ backgroundColor: color }}
        >
          {band.cta.label}
        </motion.button>
      ) : null}

      {/* Secondary actions */}
      <motion.div variants={listItem} className="flex gap-3">
        <button
          type="button"
          onClick={onRetake}
          className="min-h-[48px] flex-1 rounded-btn border border-gray-200 text-[14px] font-semibold
                     text-gray-600 active:bg-gray-50"
        >
          Retake
        </button>
        <button
          type="button"
          onClick={onExit}
          className="min-h-[48px] flex-1 rounded-btn border border-gray-200 text-[14px] font-semibold
                     text-gray-600 active:bg-gray-50"
        >
          Done
        </button>
      </motion.div>
    </motion.div>
  )
}
