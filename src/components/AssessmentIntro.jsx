import CoverImage from './CoverImage.jsx'
import { InfoIcon } from './Icons.jsx'
import { iconFor } from '../lib/iconFor.js'

// Intro screen for an assessment: a photographic banner, an overlapping card
// carrying the identity, then the explanation, disclaimer and the start action.
export default function AssessmentIntro({ assessment, retake, onStart }) {
  const color = assessment.color || '#FF751C'
  const bg = assessment.bg || '#FFEADD'
  const Icon = iconFor(assessment.icon)
  const questionCount = assessment.questions?.length ?? 0

  const pill = 'rounded-pill px-3.5 py-1.5 text-[12px] font-bold'

  return (
    <div>
      <div className="relative -mx-5 lg:-mx-8">
        <CoverImage src={assessment.cover} className="h-[150px] w-full" />
        <div aria-hidden className="absolute inset-0 bg-navy/55" />
      </div>

      <div className="relative -mt-14">
        <div className="rounded-card bg-white p-6 shadow-card">
          <span
            aria-hidden
            className="grid h-14 w-14 place-items-center rounded-btn"
            style={{ backgroundColor: bg, color }}
          >
            <Icon className="h-7 w-7" />
          </span>
          <h1 className="mt-4 font-display text-[28px] font-extrabold leading-tight text-navy">
            {assessment.title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            {assessment.time_mins ? (
              <span className={pill} style={{ backgroundColor: bg, color }}>
                About {assessment.time_mins} min
              </span>
            ) : null}
            <span className={pill} style={{ backgroundColor: bg, color }}>
              {questionCount} Questions
            </span>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {assessment.subtitle ? (
            <p className="text-[15px] leading-relaxed text-slate-600">{assessment.subtitle}</p>
          ) : null}
          {assessment.description ? (
            <p className="text-[15px] leading-relaxed text-slate-600">{assessment.description}</p>
          ) : null}
          {assessment.instructions ? (
            <p className="text-[15px] leading-relaxed text-slate-600">{assessment.instructions}</p>
          ) : null}
        </div>

        {/* Screening, not diagnosis — kept visually distinct from the body copy. */}
        {assessment.disclaimer ? (
          <div className="mt-6 flex gap-3 rounded-card bg-white p-4 shadow-soft">
            <InfoIcon className="h-5 w-5 shrink-0" style={{ color }} />
            <p className="text-[13px] leading-relaxed text-slate-500">{assessment.disclaimer}</p>
          </div>
        ) : null}

        {retake?.hasHistory && !retake.due && retake.daysLeft > 0 ? (
          <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
            You took this recently. Retaking now is fine — but these check-ins are most useful when
            spaced out. We'd suggest about {retake.daysLeft} more day
            {retake.daysLeft === 1 ? '' : 's'}.
          </p>
        ) : null}

        <button
          type="button"
          onClick={onStart}
          className="mt-8 grid min-h-[52px] w-full place-items-center rounded-btn text-[15px] font-extrabold text-white transition active:scale-[0.99]"
          style={{ backgroundColor: color }}
        >
          {retake?.hasHistory ? 'Take It Again' : 'Start Assessment'}
        </button>
      </div>
    </div>
  )
}
