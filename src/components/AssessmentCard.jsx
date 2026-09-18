import { ChevronRightIcon } from './Icons.jsx'
import { iconFor } from '../lib/iconFor.js'

// Row in the assessments list: a tinted icon chip, the copy, and a meta line
// giving the time cost up front. Each assessment carries its own colour pair
// (`color` / `bg`) from the content JSON.
export default function AssessmentCard({ assessment, record, retake, onOpen }) {
  const Icon = iconFor(assessment.icon)
  const questionCount = assessment.questions?.length ?? 0
  const color = assessment.color || '#FF751C'

  return (
    <button
      type="button"
      onClick={() => onOpen(assessment.id)}
      className="card-press flex w-full items-center gap-4 rounded-card bg-surface p-5 text-left shadow-card"
    >
      <span
        aria-hidden
        className="grid h-12 w-12 shrink-0 place-items-center rounded-btn"
        style={{ backgroundColor: assessment.bg || '#FFEADD', color }}
      >
        <Icon className="h-6 w-6" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="font-display text-[18px] font-extrabold leading-snug text-ink">
          {assessment.title}
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          {assessment.subtitle || assessment.description}
        </p>
        <p className="mt-2.5 text-[12px] font-bold" style={{ color }}>
          {assessment.time_mins} min · {questionCount} Questions
          {record?.lastDate && retake && !retake.due ? (
            <span className="text-slate-400">
              {' '}
              · retake in {retake.daysLeft} day{retake.daysLeft === 1 ? '' : 's'}
            </span>
          ) : null}
        </p>
      </div>

      <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-400" />
    </button>
  )
}
