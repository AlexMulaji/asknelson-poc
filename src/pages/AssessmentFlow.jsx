import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { questionSlide } from '../lib/motion.js'
import AssessmentIntro from '../components/AssessmentIntro.jsx'
import QuestionCard from '../components/QuestionCard.jsx'
import AssessmentResult from '../components/AssessmentResult.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { CloseIcon } from '../components/Icons.jsx'
import { computeResult } from '../lib/assessmentScoring.js'
import { useAssessmentHistory, retakeInfo } from '../hooks/useAssessmentHistory.js'
import { useContent } from '../hooks/useContent.js'
import { flushNow, track } from '../lib/analytics.js'

// Orchestrates a single assessment: intro -> one question at a time -> results.
// Responses live in component state only (session/device, never persisted);
// only the final score/band/date is saved, via useAssessmentHistory.
export default function AssessmentFlow() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { getRecord, saveResult } = useAssessmentHistory()

  const assessmentsFile = useContent('assessments')
  const assessments = useMemo(() => assessmentsFile?.assessments ?? [], [assessmentsFile])

  const assessment = useMemo(
    () => assessments.find((a) => a.id === id) || null,
    [id, assessments]
  )

  const [step, setStep] = useState('intro') // 'intro' | 'questions' | 'results'
  const [index, setIndex] = useState(0)
  const [responses, setResponses] = useState({})
  const advanceTimer = useRef(null)
  const savedRef = useRef(false)

  // Reset everything if the assessment id changes (defensive).
  useEffect(() => {
    setStep('intro')
    setIndex(0)
    setResponses({})
    savedRef.current = false
  }, [id])

  // Scroll to top whenever the step or question changes.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [step, index])

  // Clean up any pending auto-advance timer on unmount.
  useEffect(() => () => window.clearTimeout(advanceTimer.current), [])

  const result = useMemo(
    () => (assessment && step === 'results' ? computeResult(assessment, responses) : null),
    [assessment, step, responses]
  )

  // Save the result once, when we land on the results step. We persist only
  // score / band / date — never the raw responses.
  useEffect(() => {
    if (step === 'results' && result && assessment && !savedRef.current) {
      savedRef.current = true
      saveResult(assessment.id, { score: result.total, band: result.band?.band ?? null })

      // Same privacy rule as storage: score and band only, never the answers.
      // safety_triggered is a bare boolean — it says a duty-of-care screen was
      // shown, not which item was answered how.
      track('assessment_completed', {
        assessment: assessment.id,
        title: assessment.title,
        score: result.total,
        band: result.band?.band ?? null,
        safety_triggered: Boolean(result.safetyTriggered),
      })
      // A triggered safety screen matters immediately — don't sit in the queue.
      if (result.safetyTriggered) flushNow()
    }
  }, [step, result, assessment, saveResult])

  // --- Assessment not found -------------------------------------------------
  if (!assessment) {
    return (
      <div className="page-enter">
        <FlowHeader title="Assessment" onClose={() => navigate('/assessments')} />
        <div className="px-5 pt-4">
          <EmptyState
            title="We couldn't find that check-in"
            message="It may have been moved or renamed. Head back and pick one from the list."
          />
        </div>
      </div>
    )
  }

  const questions = assessment.questions ?? []
  const currentQuestion = questions[index]
  const color = assessment.color || '#172B5C'

  function handleSelect(value) {
    const qId = currentQuestion.id
    setResponses((prev) => ({ ...prev, [qId]: value }))

    window.clearTimeout(advanceTimer.current)
    // Brief pause so the selection is visible before moving on.
    advanceTimer.current = window.setTimeout(() => {
      if (index + 1 < questions.length) {
        setIndex((i) => i + 1)
      } else {
        setStep('results')
      }
    }, 220)
  }

  function handleBack() {
    window.clearTimeout(advanceTimer.current)
    if (index > 0) setIndex((i) => i - 1)
    else setStep('intro')
  }

  function startQuestions() {
    const isRetake = step === 'results'
    setResponses({})
    setIndex(0)
    savedRef.current = false
    setStep('questions')
    track('assessment_started', {
      assessment: assessment.id,
      title: assessment.title,
      questions: questions.length,
      retake: isRetake,
    })
  }

  // Leaving part-way through is worth knowing about (a screener that loses
  // people half-way may be too long). We record only how far they got.
  function handleClose() {
    if (step === 'questions') {
      track('assessment_abandoned', {
        assessment: assessment.id,
        answered: Object.keys(responses).length,
        questions: questions.length,
      })
    }
    navigate('/assessments')
  }

  const record = getRecord(assessment.id)
  const retake = retakeInfo(record, assessment.retake_after_days)

  return (
    <div className="page-enter">
      <FlowHeader title={assessment.title} color={color} onClose={handleClose} />

      {/* Focused, readable column on desktop. */}
      <div className="px-5 pt-4 pb-8 lg:mx-auto lg:max-w-2xl">
        {step === 'intro' ? (
          <AssessmentIntro assessment={assessment} retake={retake} onStart={startQuestions} />
        ) : null}

        {step === 'questions' && currentQuestion ? (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={index}
              variants={questionSlide}
              initial="enter"
              animate="center"
              exit="exit"
            >
              <QuestionCard
                assessment={assessment}
                question={currentQuestion}
                index={index}
                total={questions.length}
                selectedValue={responses[currentQuestion.id]}
                onSelect={handleSelect}
                onBack={handleBack}
              />
            </motion.div>
          </AnimatePresence>
        ) : null}

        {step === 'results' && result ? (
          <AssessmentResult
            assessment={assessment}
            result={result}
            history={record?.history}
            onRetake={startQuestions}
            onExit={() => navigate('/assessments')}
          />
        ) : null}
      </div>
    </div>
  )
}

// Sticky frosted header with a close affordance — mirrors PageHeader styling.
function FlowHeader({ title, onClose }) {
  return (
    <header
      className={[
        'sticky top-0 z-30 flex items-center gap-2 px-3 pb-3',
        'pt-[calc(1.5rem+env(safe-area-inset-top,0px))]',
        'bg-white/92 backdrop-blur-md',
        '[box-shadow:0_1px_0_0_rgb(0_0_0/0.06)]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close assessment"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 active:bg-gray-100"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
      <h1 className="truncate text-[17px] font-bold leading-tight text-black">{title}</h1>
    </header>
  )
}
