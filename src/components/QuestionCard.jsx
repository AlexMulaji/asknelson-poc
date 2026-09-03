import { getQuestionOptions } from '../lib/assessmentScoring.js'
import { ChevronLeftIcon, CheckIcon } from './Icons.jsx'
import ConfidentialityStamp from './ConfidentialityStamp.jsx'

// One question at a time. Tapping an option selects it (and the parent
// auto-advances). A Back control lets the user revise an earlier answer.
export default function QuestionCard({
  assessment,
  question,
  index,
  total,
  selectedValue,
  onSelect,
  onBack,
}) {
  const color = assessment.color || '#FF751C'
  const options = getQuestionOptions(assessment, question)
  const progress = total > 0 ? ((index + 1) / total) * 100 : 0
  const canGoBack = index > 0

  return (
    <div className="flex min-h-[70vh] flex-col">
      {/* Progress */}
      <div>
        <div className="mb-2 flex items-center justify-between text-[13px] font-bold text-slate-400">
          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack}
            className="-ml-1 inline-flex min-h-[32px] items-center gap-1 pr-2 transition-opacity disabled:opacity-0"
            aria-label="Previous question"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Back
          </button>
          <span>
            {index + 1} of {total}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-line">
          <span
            className="block h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, backgroundColor: color }}
          />
        </div>
      </div>

      {/* Question */}
      <h2 className="mt-8 font-display text-[24px] font-extrabold leading-snug text-navy">
        {question.text}
      </h2>

      {/* Options */}
      <div className="mt-6 space-y-3">
        {options.map((opt) => {
          const isSelected = selectedValue === opt.value
          return (
            <button
              key={`${opt.label}-${opt.value}`}
              type="button"
              onClick={() => onSelect(opt.value)}
              aria-pressed={isSelected}
              className={[
                'flex min-h-[58px] w-full items-center justify-between gap-3 rounded-card border px-5 py-4 text-left',
                'text-[15px] font-bold transition-all duration-150 active:scale-[0.99]',
                isSelected ? '' : 'border-line bg-white text-slate-600 hover:border-slate-300',
              ].join(' ')}
              style={
                isSelected
                  ? { borderColor: color, backgroundColor: assessment.bg || '#FFEADD', color }
                  : undefined
              }
            >
              <span>{opt.label}</span>
              <span
                aria-hidden
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2"
                style={
                  isSelected
                    ? { backgroundColor: color, borderColor: color, color: '#fff' }
                    : { borderColor: '#D7DEE2' }
                }
              >
                {isSelected ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} /> : null}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-auto flex justify-center pt-10">
        <ConfidentialityStamp imgClassName="max-w-[160px]" />
      </div>
    </div>
  )
}
