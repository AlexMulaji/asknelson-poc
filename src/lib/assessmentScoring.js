// Pure, JSON-driven scoring for assessments. No React, no side effects — so the
// rules stay testable and content can be edited in assessments.json alone.
//
// A "response" is the raw value of the option the user selected. Reverse-scored
// questions are transformed at scoring time (see scoreQuestion).

/**
 * Resolve the options shown for a question.
 * Per-question `options` win (e.g. the Sleep assessment); otherwise the
 * assessment-level `response_scale` is used.
 */
export function getQuestionOptions(assessment, question) {
  if (Array.isArray(question?.options) && question.options.length > 0) {
    return question.options
  }
  return Array.isArray(assessment?.response_scale) ? assessment.response_scale : []
}

/**
 * The scale maximum used for reverse scoring. Prefer the explicit value in the
 * scoring object; fall back to the largest available option value.
 */
export function getScaleMax(assessment) {
  const explicit = assessment?.scoring?.scale_max
  if (typeof explicit === 'number') return explicit

  let max = 0
  const scale = Array.isArray(assessment?.response_scale) ? assessment.response_scale : []
  for (const opt of scale) {
    if (typeof opt.value === 'number' && opt.value > max) max = opt.value
  }
  for (const q of assessment?.questions ?? []) {
    for (const opt of q.options ?? []) {
      if (typeof opt.value === 'number' && opt.value > max) max = opt.value
    }
  }
  return max
}

/**
 * Score a single question's raw response, applying reverse scoring when the
 * question is flagged `reverse: true` (score = scale_max - response), so that
 * higher always means "more of the thing being measured".
 */
export function scoreQuestion(assessment, question, rawValue) {
  if (typeof rawValue !== 'number') return 0
  if (question?.reverse) return getScaleMax(assessment) - rawValue
  return rawValue
}

/**
 * Parse a safety `trigger_when` expression like "value > 0" into a threshold.
 * Defaults to 0 (i.e. any value above 0 triggers) if it can't be parsed.
 */
function parseSafetyThreshold(triggerWhen) {
  if (typeof triggerWhen !== 'string') return 0
  const match = triggerWhen.match(/>\s*(\d+)/)
  return match ? Number(match[1]) : 0
}

/**
 * Compute a full result from a map of { questionId: rawValue }.
 *
 * Returns:
 *   total          — summed score (with reverse applied)
 *   band           — the matching results[] entry (by min/max range)
 *   dimensions     — [{ id, label, subtotal, max, highThreshold, flagged, note }]
 *   flags          — notes for any dimension at/above its high_threshold
 *   safetyTriggered — true when the safety trigger question fires
 *   safety         — the assessment.safety object (for the gate UI)
 *   answeredCount / questionCount — completion bookkeeping
 */
export function computeResult(assessment, responses) {
  const questions = assessment?.questions ?? []
  const scoring = assessment?.scoring ?? {}

  let total = 0
  let answeredCount = 0
  for (const q of questions) {
    const raw = responses?.[q.id]
    if (typeof raw === 'number') {
      total += scoreQuestion(assessment, q, raw)
      answeredCount += 1
    }
  }

  // --- Per-dimension subtotals (e.g. burnout) -------------------------------
  const dimensions = []
  const flags = []
  if (scoring.type === 'sum_with_dimensions' && Array.isArray(scoring.dimensions)) {
    for (const dim of scoring.dimensions) {
      let subtotal = 0
      for (const qid of dim.questions ?? []) {
        const q = questions.find((x) => x.id === qid)
        const raw = responses?.[qid]
        if (q && typeof raw === 'number') subtotal += scoreQuestion(assessment, q, raw)
      }
      const high = dim.high_threshold
      const flagged = typeof high === 'number' && subtotal >= high
      const note = flagged ? assessment?.dimension_flags?.[dim.id] : undefined
      dimensions.push({
        id: dim.id,
        label: dim.label,
        subtotal,
        min: dim.min ?? 0,
        max: dim.max,
        highThreshold: high,
        flagged,
        note,
      })
      if (flagged && note) flags.push({ id: dim.id, label: dim.label, note })
    }
  }

  // --- Band match (by inclusive min/max range) ------------------------------
  const results = Array.isArray(assessment?.results) ? assessment.results : []
  const band =
    results.find((r) => total >= r.min && total <= r.max) ??
    results[results.length - 1] ??
    null

  // --- Safety gate ----------------------------------------------------------
  let safetyTriggered = false
  const safety = assessment?.safety ?? null
  if (safety?.trigger_question) {
    const raw = responses?.[safety.trigger_question]
    const threshold = parseSafetyThreshold(safety.trigger_when)
    safetyTriggered = typeof raw === 'number' && raw > threshold
  }

  return {
    total,
    band,
    dimensions,
    flags,
    safetyTriggered,
    safety,
    answeredCount,
    questionCount: questions.length,
  }
}
