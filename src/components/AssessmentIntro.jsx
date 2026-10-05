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
        <CoverImage src={assessment.cover} width={16} height={9} className="h-[224px] w-full lg:h-[300px]" />
        <div aria-hidden className="absolute inset-0 bg-navy/55" />
      </div>

      <div className="relative -mt-[124px] lg:-mt-40">
        <div className="rounded-card bg-surface p-6 shadow-card">
          <span
            aria-hidden
            className="grid h-14 w-14 place-items-center rounded-btn"
            style={{ backgroundColor: bg, color }}
          >
            <Icon className="h-7 w-7" />
          </span>
          <h1 className="mt-4 font-display text-[32px] font-extrabold leading-tight text-ink lg:text-[40px]">
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
          <div className="mt-6 flex gap-3 rounded-card bg-surface p-4 shadow-soft">
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

        {/* On mobile the start action stays in reach at the foot of the screen,
            over a fade into the page. Sticky rather than fixed: the page
            wrapper keeps a transform from .page-enter, which would anchor a
            fixed bar to the wrapper instead of the viewport. */}
        <div
          className={[
            'sticky bottom-0 -mx-5 mt-8 px-5 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]',
            'bg-[linear-gradient(transparent,rgb(var(--surface))_30%)]',
            'lg:static lg:mx-0 lg:bg-none lg:p-0',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={onStart}
            className="grid min-h-[56px] w-full place-items-center rounded-btn text-[18px] font-extrabold text-white transition active:scale-[0.99] lg:min-h-[52px] lg:text-[15px]"
            style={{ backgroundColor: color }}
          >
            {retake?.hasHistory ? 'Take It Again' : 'Start Assessment'}
          </button>
        </div>
      </div>
    </div>
  )
}
