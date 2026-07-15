import { ClipboardCheckIcon, CheckIcon } from './Icons.jsx'
import { withAlpha } from '../lib/colorUtils.js'

// A selectable assessment card for the Assessments landing screen.
// Visual language matches JourneyCard: a top colour stripe, tinted icon chip,
// title, subtitle, and a meta row. Shows a gentle retake hint when there's
// saved history on this device.
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function AssessmentCard({ assessment, record, retake, onOpen }) {
  const color = assessment.color || '#172B5C'
  const bg = assessment.bg || '#EEF1F6'

  // Retake hint: due → encourage; not due → show when it's worth retaking.
  let hint = null
  if (record?.lastDate) {
    if (retake?.due) {
      hint = `Last taken ${formatDate(record.lastDate)} · ready to retake`
    } else if (retake?.daysLeft > 0) {
      hint = `Last taken ${formatDate(record.lastDate)} · retake in ${retake.daysLeft} day${
        retake.daysLeft === 1 ? '' : 's'
      }`
    } else {
      hint = `Last taken ${formatDate(record.lastDate)}`
    }
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(assessment.id)}
      className="card-press block w-full overflow-hidden rounded-card bg-white text-left shadow-card"
    >
      {/* Top colour stripe */}
      <span aria-hidden className="block h-1.5 w-full" style={{ backgroundColor: color }} />
      <div
        className="flex items-start gap-3 p-5"
        style={{ background: `linear-gradient(180deg, ${withAlpha(color, 0.08)} 0%, #fff 46%)` }}
      >
        {/* Tinted icon chip (brand icons not yet wired — colour carries identity) */}
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn"
          style={{ backgroundColor: bg, color }}
        >
          <ClipboardCheckIcon className="h-6 w-6" />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[18px] font-semibold leading-snug text-black">
            {assessment.title}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{assessment.subtitle}</p>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-400">
            {assessment.time_mins ? <span>{assessment.time_mins} min</span> : null}
            {record?.lastBand ? (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1" style={{ color }}>
                  <CheckIcon className="h-3.5 w-3.5" />
                  Last: {record.lastBand}
                </span>
              </>
            ) : null}
          </div>

          {hint ? <p className="mt-1.5 text-[12px] text-gray-400">{hint}</p> : null}
        </div>
      </div>
    </button>
  )
}
