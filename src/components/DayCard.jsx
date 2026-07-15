import { LockIcon, CheckIcon, ExternalLinkIcon } from './Icons.jsx'

const TYPE_COLORS = {
  read: '#172B5C',
  watch: '#4CB03F',
  reflect: '#7C5CBF',
  practice: '#E08A2B',
}

function titleCase(s) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// status: 'completed' | 'current' | 'locked'
export default function DayCard({ day, status, color, onMarkDone, prominent = false }) {
  const isLocked = status === 'locked'
  const isCompleted = status === 'completed'
  const isCurrent = status === 'current'
  const typeKey = (day.type || '').toLowerCase()
  const badgeColor = TYPE_COLORS[typeKey] || color || '#172B5C'

  return (
    <div
      className={[
        'rounded-card bg-white',
        prominent ? 'p-5 shadow-card' : 'border px-4 py-3.5',
        isCurrent ? 'border-2 shadow-card' : 'border border-gray-100',
        isLocked ? 'opacity-55' : '',
        isCompleted && !prominent ? 'bg-gray-50' : '',
      ].join(' ')}
      style={isCurrent ? { borderColor: color || '#172B5C' } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-400">Day {day.day}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white"
              style={{ backgroundColor: badgeColor }}
            >
              {titleCase(day.type)}
            </span>
          </div>
          <h3
            className={[
              'mt-1.5 font-semibold leading-snug text-black',
              prominent ? 'font-display text-[18px]' : 'text-[13px]',
            ].join(' ')}
          >
            {day.title}
          </h3>
        </div>

        {isCompleted ? (
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: color || '#4CB03F' }}
          >
            <CheckIcon className="h-4 w-4" />
          </span>
        ) : isLocked ? (
          <LockIcon className="h-4 w-4 shrink-0 text-gray-300" />
        ) : null}
      </div>

      {prominent ? (
        <>
          {day.task ? (
            <p className="mt-3 text-[14px] leading-relaxed text-gray-600">{day.task}</p>
          ) : null}

          {day.source_url ? (
            <a
              href={day.source_url}
              target="_blank"
              rel="noopener noreferrer"
              // 44px min-height touch target
              className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-medium"
              style={{ color: color || '#172B5C' }}
            >
              {day.source_title || 'Open resource'}
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          ) : null}

          {day.reflection ? (
            <p className="mt-3 rounded-btn bg-gray-50 px-3 py-2.5 text-[13px] italic leading-relaxed text-gray-500">
              {day.reflection}
            </p>
          ) : null}

          {isCurrent && onMarkDone ? (
            <button
              type="button"
              onClick={() => onMarkDone(day.day)}
              className="mt-4 min-h-[48px] w-full rounded-btn text-[14px] font-semibold text-white
                         transition-transform duration-100 active:scale-[0.97]"
              style={{ backgroundColor: color || '#172B5C' }}
            >
              Mark as done
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
