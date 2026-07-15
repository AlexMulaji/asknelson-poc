import { useCallback, useState } from 'react'

// localStorage layout (mirrors the journey-progress pattern):
//   asknelson.assessment.<id> -> {
//     lastScore, lastBand, lastDate (ISO),
//     history: [ { date, score, band } ]   // newest last
//   }
//
// PRIVACY: we deliberately persist only score / band / date — never the raw
// question responses. Sensitive answers (e.g. the self-harm screening item)
// are kept in memory for the session only and are never written to storage.

const recordKey = (assessmentId) => `asknelson.assessment.${assessmentId}`
const MAX_HISTORY = 20
const DAY_MS = 24 * 60 * 60 * 1000

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function readAll() {
  const out = {}
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith('asknelson.assessment.')) {
        const id = key.slice('asknelson.assessment.'.length)
        out[id] = readJSON(key, null)
      }
    }
  } catch {
    /* ignore */
  }
  return out
}

/**
 * Compute whether an assessment is due for a retake.
 *   { hasHistory, due, nextDate, daysLeft }
 * `due` is true when there's no history or enough days have passed.
 */
export function retakeInfo(record, retakeAfterDays) {
  if (!record?.lastDate) return { hasHistory: false, due: true, nextDate: null, daysLeft: 0 }
  if (typeof retakeAfterDays !== 'number') {
    return { hasHistory: true, due: true, nextDate: null, daysLeft: 0 }
  }
  const last = new Date(record.lastDate).getTime()
  const next = last + retakeAfterDays * DAY_MS
  const daysLeft = Math.max(0, Math.ceil((next - Date.now()) / DAY_MS))
  return {
    hasHistory: true,
    due: Date.now() >= next,
    nextDate: new Date(next).toISOString(),
    daysLeft,
  }
}

/**
 * Manage saved assessment results (score + date history) on this device.
 */
export function useAssessmentHistory() {
  const [records, setRecords] = useState(() => readAll())

  const getRecord = useCallback((assessmentId) => records[assessmentId] ?? null, [records])

  const saveResult = useCallback((assessmentId, { score, band }) => {
    const key = recordKey(assessmentId)
    const existing = readJSON(key, null)
    const date = new Date().toISOString()
    const entry = { date, score, band: band ?? null }
    const history = [...(existing?.history ?? []), entry].slice(-MAX_HISTORY)
    const next = { lastScore: score, lastBand: band ?? null, lastDate: date, history }
    writeJSON(key, next)
    setRecords((prev) => ({ ...prev, [assessmentId]: next }))
    return next
  }, [])

  return { records, getRecord, saveResult }
}
