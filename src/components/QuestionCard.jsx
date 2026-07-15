import { getQuestionOptions } from '../lib/assessmentScoring.js'
import { ChevronLeftIcon, CheckIcon } from './Icons.jsx'

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
  const color = assessment.color || '#172B5C'
  const options = getQuestionOptions(assessment, question)
  const progress = total > 0 ? ((index + 1) / total) * 100 : 0
  const canGoBack = index > 0

  return (
    <div>
      {/* Progress */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between text-[12px] font-medium text-gray-400">
          <button
            type="button"
            onClick={onBack}
            disabled={!canGoBack}
            className="inline-flex min-h-[32px] items-center gap-1 -ml-1 pr-2 transition-opacity disabled:opacity-0"
            aria-label="Previous question"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Back
          </button>
          <span>
            {index + 1} of {total}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <span
            className="block h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%`, backgroundColor: color }}
          />
        </div>
      </div>

      {/* Question */}
      <h2 className="font-display text-[22px] font-semibold leading-snug text-black">
        {question.text}
      </h2>

      {/* Options */}
      <div className="mt-5 space-y-2.5">
        {options.map((opt) => {
          const isSelected = selectedValue === opt.value
          return (
            <button
              key={`${opt.label}-${opt.value}`}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={[
                'flex min-h-[52px] w-full items-center justify-between gap-3 rounded-btn border px-4 py-3 text-left',
                'text-[15px] font-medium transition-all duration-150 active:scale-[0.99]',
                isSelected ? 'text-black' : 'border-gray-200 bg-white text-gray-700',
              ].join(' ')}
              style={
                isSelected
                  ? { borderColor: color, backgroundColor: `${color}0F` }
                  : undefined
              }
              aria-pressed={isSelected}
            >
              <span>{opt.label}</span>
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                style={
                  isSelected
                    ? { backgroundColor: color, borderColor: color, color: '#fff' }
                    : { borderColor: '#D1D5DB' }
                }
              >
                {isSelected ? <CheckIcon className="h-3.5 w-3.5" /> : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
