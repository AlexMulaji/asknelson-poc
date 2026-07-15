import { useCallback, useEffect, useState } from 'react'

// localStorage layout:
//   asknelson.activeJourney        -> journeyId (string) | null
//   asknelson.journey.<journeyId>  -> { startDate, completedDays: number[] }

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

/**
 * Manage the single active journey and its day-by-day progress.
 */
export function useJourneyProgress() {
  const [activeJourneyId, setActiveJourneyId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) || null
    } catch {
      return null
    }
  })

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

  const startJourney = useCallback((journeyId) => {
    const fresh = { startDate: new Date().toISOString(), completedDays: [] }
    writeJSON(progressKey(journeyId), fresh)
    try {
      localStorage.setItem(ACTIVE_KEY, journeyId)
    } catch {
      /* ignore */
    }
    setActiveJourneyId(journeyId)
    setProgress(fresh)
  }, [])

  const switchJourney = useCallback(
    (journeyId) => {
      // Preserve any prior progress on this journey; only reset if brand new.
      const existing = readJSON(progressKey(journeyId), null)
      if (existing) {
        try {
          localStorage.setItem(ACTIVE_KEY, journeyId)
        } catch {
          /* ignore */
        }
        setActiveJourneyId(journeyId)
        setProgress(existing)
      } else {
        startJourney(journeyId)
      }
    },
    [startJourney]
  )

  const markDayDone = useCallback(
    (dayNumber) => {
      if (!activeJourneyId) return
      setProgress((prev) => {
        const current = prev || { startDate: new Date().toISOString(), completedDays: [] }
        if (current.completedDays.includes(dayNumber)) return current
        const next = {
          ...current,
          completedDays: [...current.completedDays, dayNumber].sort((a, b) => a - b),
        }
        writeJSON(progressKey(activeJourneyId), next)
        return next
      })
    },
    [activeJourneyId]
  )

  const resetActiveJourney = useCallback(() => {
    try {
      localStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* ignore */
    }
    setActiveJourneyId(null)
    setProgress(null)
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
