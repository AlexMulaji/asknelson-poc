import { useCallback, useEffect, useState } from 'react'
import {
  PROGRESS_EVENT,
  notifyProgressChanged,
  pushActiveJourney,
  pushDayDone,
  pushJourney,
} from '../lib/progressSync.js'

// localStorage layout:
//   asknelson.activeJourney        -> journeyId (string) | null
//   asknelson.journey.<journeyId>  -> { startDate, completedDays: number[] }
//
// When signed in, every change is also saved to the account (lib/progressSync),
// and the account's progress is written back here on sign-in — so a member
// picks up where they left off on any device.

const ACTIVE_KEY = 'asknelson.activeJourney'
const progressKey = (journeyId) => `asknelson.journey.${journeyId}`

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
    /* ignore quota / privacy mode errors */
  }
}

function readActive() {
  try {
    return localStorage.getItem(ACTIVE_KEY) || null
  } catch {
    return null
  }
}

function writeActive(journeyId) {
  try {
    if (journeyId) localStorage.setItem(ACTIVE_KEY, journeyId)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Manage the single active journey and its day-by-day progress.
 */
export function useJourneyProgress() {
  const [activeJourneyId, setActiveJourneyId] = useState(readActive)

  const [progress, setProgress] = useState(() =>
    activeJourneyId ? readJSON(progressKey(activeJourneyId), null) : null
  )

  // Keep progress in sync whenever the active journey changes.
  useEffect(() => {
    if (!activeJourneyId) {
      setProgress(null)
      return
    }
    setProgress(readJSON(progressKey(activeJourneyId), null))
  }, [activeJourneyId])

  // Re-read storage whenever progress changes elsewhere: another mounted copy
  // of this hook, an assessment CTA, or the account's progress arriving.
  useEffect(() => {
    const reload = () => {
      const id = readActive()
      setActiveJourneyId(id)
      setProgress(id ? readJSON(progressKey(id), null) : null)
    }
    window.addEventListener(PROGRESS_EVENT, reload)
    return () => window.removeEventListener(PROGRESS_EVENT, reload)
  }, [])

  const startJourney = useCallback((journeyId) => {
    const fresh = { startDate: new Date().toISOString(), completedDays: [] }
    writeJSON(progressKey(journeyId), fresh)
    writeActive(journeyId)
    setActiveJourneyId(journeyId)
    setProgress(fresh)
    pushJourney(journeyId, fresh, { active: true })
    notifyProgressChanged()
  }, [])

  const switchJourney = useCallback(
    (journeyId) => {
      // Preserve any prior progress on this journey; only reset if brand new.
      const existing = readJSON(progressKey(journeyId), null)
      if (existing) {
        writeActive(journeyId)
        setActiveJourneyId(journeyId)
        setProgress(existing)
        pushActiveJourney(journeyId)
        notifyProgressChanged()
      } else {
        startJourney(journeyId)
      }
    },
    [startJourney]
  )

  // `totalDays` (optional) lets the account record when a journey is finished.
  const markDayDone = useCallback(
    (dayNumber, totalDays) => {
      if (!activeJourneyId) return
      // Read storage rather than state: it is the source of truth, and keeps
      // side effects out of a state updater (which StrictMode runs twice).
      const current = readJSON(progressKey(activeJourneyId), null) || {
        startDate: new Date().toISOString(),
        completedDays: [],
      }
      if (current.completedDays.includes(dayNumber)) return
      const next = {
        ...current,
        completedDays: [...current.completedDays, dayNumber].sort((a, b) => a - b),
      }
      writeJSON(progressKey(activeJourneyId), next)
      setProgress(next)
      pushDayDone(activeJourneyId, dayNumber, totalDays)
      notifyProgressChanged()
    },
    [activeJourneyId]
  )

  const resetActiveJourney = useCallback(() => {
    writeActive(null)
    setActiveJourneyId(null)
    setProgress(null)
    pushActiveJourney(null)
    notifyProgressChanged()
  }, [])

  // The next day the user should work on (1-based). Defaults to day 1.
  const completedDays = progress?.completedDays ?? []
  const currentDay = completedDays.length > 0 ? Math.max(...completedDays) + 1 : 1

  return {
    activeJourneyId,
    progress,
    completedDays,
    currentDay,
    startJourney,
    switchJourney,
    markDayDone,
    resetActiveJourney,
  }
}
