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
      className="card-press flex w-full items-start gap-3.5 rounded-card bg-surface p-5 text-left shadow-card lg:items-center lg:gap-6"
    >
      <span
        aria-hidden
        className="grid h-10 w-10 shrink-0 place-items-center rounded-[4px] lg:h-20 lg:w-20"
        style={{ backgroundColor: assessment.bg || '#FFEADD', color }}
      >
        <Icon className="h-6 w-6 lg:h-[52px] lg:w-[52px]" />
      </span>

      <div className="min-w-0 flex-1">
        <h3 className="font-display text-[22px] font-extrabold leading-tight text-ink lg:text-[28px]">
          {assessment.title}
        </h3>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft lg:text-[16px]">
          {assessment.subtitle || assessment.description}
        </p>
        <p className="mt-4 text-[12px] font-bold lg:mt-3 lg:text-[14px]" style={{ color }}>
          {assessment.time_mins} min · {questionCount} Questions
          {record?.lastBand ? <> · Last result: {record.lastBand}</> : null}
          {record?.lastDate && retake && !retake.due ? (
            <span className="text-slate-400">
              {' '}
              · retake in {retake.daysLeft} day{retake.daysLeft === 1 ? '' : 's'}
            </span>
          ) : null}
        </p>
      </div>

      <ChevronRightIcon className="h-5 w-5 shrink-0 self-center text-muted" />
    </button>
  )
}
