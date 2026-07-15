import { meshGradient } from '../lib/colorUtils.js'

// Intro screen for an assessment: sets expectations before the questions.
// Shows description, time, instructions, and the disclaimer — all from JSON.
export default function AssessmentIntro({ assessment, retake, onStart }) {
  const color = assessment.color || '#172B5C'
  const bg = assessment.bg || '#EEF1F6'
  const questionCount = assessment.questions?.length ?? 0

  return (
    <div className="space-y-5">
      {/* Mesh-gradient hero — carries the assessment's colour identity */}
      <div className="rounded-hero p-6" style={{ background: meshGradient(color) }}>
        <h1 className="font-display text-[28px] font-semibold leading-tight text-black">
          {assessment.title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-gray-700">{assessment.subtitle}</p>
      </div>

      {/* Description */}
      <p className="text-[15px] leading-relaxed text-gray-700">{assessment.description}</p>

      {/* Quick facts */}
      <div className="flex flex-wrap gap-2">
        {assessment.time_mins ? (
          <span
            className="rounded-full px-3 py-1 text-[12px] font-semibold"
            style={{ backgroundColor: bg, color }}
          >
            About {assessment.time_mins} min
          </span>
        ) : null}
        <span
          className="rounded-full px-3 py-1 text-[12px] font-semibold"
          style={{ backgroundColor: bg, color }}
        >
          {questionCount} questions
        </span>
      </div>

      {/* Instructions */}
      {assessment.instructions ? (
        <div className="rounded-card border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Before you start
          </p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-gray-700">
            {assessment.instructions}
          </p>
        </div>
      ) : null}

      {/* Retake note when there's recent history */}
      {retake?.hasHistory && !retake.due && retake.daysLeft > 0 ? (
        <p className="text-[13px] leading-relaxed text-gray-500">
          You took this recently. Retaking now is fine — but these check-ins are most useful when
          spaced out. We'd suggest about {retake.daysLeft} more day
          {retake.daysLeft === 1 ? '' : 's'}.
        </p>
      ) : null}

      {/* Disclaimer — screening, not diagnosis */}
      {assessment.disclaimer ? (
        <p className="text-[12px] leading-relaxed text-gray-400">{assessment.disclaimer}</p>
      ) : null}

      {/* Start */}
      <button
        type="button"
        onClick={onStart}
        className="min-h-[48px] w-full rounded-btn text-[15px] font-semibold text-white
                   transition-transform duration-100 active:scale-[0.98]"
        style={{ backgroundColor: color }}
      >
        {retake?.hasHistory ? 'Take it again' : 'Start'}
      </button>
    </div>
  )
}
