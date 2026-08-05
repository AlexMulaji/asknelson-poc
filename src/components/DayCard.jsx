import Pill from './Pill.jsx'
import { CheckCircleIcon, ChevronRightIcon, ExternalLinkIcon, LockIcon } from './Icons.jsx'

function titleCase(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// A row in the 30-day list. `status` is 'completed' | 'current' | 'locked'.
// The current day is highlighted with a green border and wash; completed days
// carry a check; locked days show a padlock and dim back.
export default function DayCard({ day, status, onOpen, onMarkDone, expanded = false }) {
  const isLocked = status === 'locked'
  const isCompleted = status === 'completed'
  const isCurrent = status === 'current'
  const interactive = !isLocked && (onOpen || onMarkDone)

  return (
    <div
      className={[
        'rounded-card border transition',
        isCurrent ? 'border-brand bg-brand-wash' : 'border-line bg-white',
        isLocked ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div
        className={['flex items-start gap-3 px-4 py-4', interactive ? 'cursor-pointer' : ''].join(' ')}
        onClick={interactive ? () => onOpen?.(day) : undefined}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen?.(day)
                }
              }
            : undefined
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-extrabold text-brand">Day {day.day}</span>
            {day.type ? <Pill label={titleCase(day.type)} /> : null}
          </div>
          <h3 className="mt-1.5 font-display text-[17px] font-extrabold leading-snug text-navy">
            {day.title}
          </h3>
          {day.task ? (
            <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{day.task}</p>
          ) : null}
        </div>

        <span className="shrink-0 pt-1">
          {isCompleted ? (
            <CheckCircleIcon className="h-6 w-6 text-brand" />
          ) : isLocked ? (
            <LockIcon className="h-[18px] w-[18px] text-slate-300" />
          ) : (
            <ChevronRightIcon className="h-5 w-5 text-brand" />
          )}
        </span>
      </div>

      {expanded && !isLocked ? (
        <div className="border-t border-brand/25 px-4 py-4">
          {day.source_url ? (
            <a
              href={day.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-extrabold text-brand"
            >
              {day.source_title || 'Open resource'}
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          ) : null}

          {day.reflection ? (
            <p className="mt-2 rounded-btn bg-white px-3.5 py-3 text-[13px] italic leading-relaxed text-slate-500">
              {day.reflection}
            </p>
          ) : null}

          {onMarkDone && !isCompleted ? (
            <button
              type="button"
              onClick={() => onMarkDone(day.day)}
              className="mt-4 min-h-[48px] w-full rounded-btn bg-brand text-[15px] font-extrabold text-white transition hover:bg-brand-dark active:scale-[0.98]"
            >
              Mark as done
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
