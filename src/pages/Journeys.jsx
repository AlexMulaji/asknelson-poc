import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import JourneyCard from '../components/JourneyCard.jsx'
import JourneyHero from '../components/JourneyHero.jsx'
import DayCard from '../components/DayCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { listContainer, listItem } from '../lib/motion.js'
import { useJourneyProgress } from '../hooks/useJourneyProgress.js'
import { useContent } from '../hooks/useContent.js'
import { track } from '../lib/analytics.js'

function dayStatus(dayNumber, currentDay, completedDays) {
  if (completedDays.includes(dayNumber)) return 'completed'
  if (dayNumber === currentDay) return 'current'
  if (dayNumber < currentDay) return 'completed'
  return 'locked'
}

// The "Your Journey" tab of My Wellness. Renders either the programme picker or
// the active programme; `onMenuChange` lets the parent swap its ⋮ menu to match.
export default function Journeys({ onMenuChange }) {
  const journeysFile = useContent('journeys')
  const journeysData = useMemo(() => journeysFile?.journeys ?? [], [journeysFile])

  const {
    activeJourneyId,
    completedDays,
    currentDay,
    startJourney,
    switchJourney,
    markDayDone,
    resetActiveJourney,
  } = useJourneyProgress()

  const [openDay, setOpenDay] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const activeJourney = useMemo(
    () => journeysData.find((j) => j.id === activeJourneyId) || null,
    [activeJourneyId, journeysData]
  )

  // Deep link from an assessment CTA: ?journey=<id> opens that journey
  // (preserving any saved progress), then clears the param.
  const journeyParam = searchParams.get('journey')
  useEffect(() => {
    if (journeyParam && journeysData.some((j) => j.id === journeyParam)) {
      switchJourney(journeyParam)
      const next = new URLSearchParams(searchParams)
      next.delete('journey')
      setSearchParams(next, { replace: true })
    }
  }, [journeyParam, switchJourney, searchParams, setSearchParams, journeysData])

  // Offer "Change / Restart journey" in the page menu only while one is active.
  useEffect(() => {
    if (!onMenuChange) return
    onMenuChange(
      activeJourney
        ? { kind: 'journey', onChange: resetActiveJourney, onRestart: () => startJourney(activeJourney.id) }
        : null
    )
  }, [activeJourney, onMenuChange, resetActiveJourney, startJourney])

  const hasData = journeysData.length > 0

  // --- Tracked wrappers ------------------------------------------------------
  // Defined above the early returns so both the selection and progress views
  // can use them.

  const handleStart = (journeyId) => {
    startJourney(journeyId)
    const journey = journeysData.find((j) => j.id === journeyId)
    track('journey_started', { journey: journeyId, title: journey?.title })
  }

  const handleMarkDayDone = (dayNumber) => {
    markDayDone(dayNumber)
    if (!activeJourney) return
    const day = (activeJourney.days ?? []).find((d) => d.day === dayNumber)
    const total = (activeJourney.days ?? []).length
    // completedDays is this render's value, so the day just finished isn't in
    // it yet — hence the +1 when checking for the final day.
    const done = completedDays.includes(dayNumber)
      ? completedDays.length
      : completedDays.length + 1

    track('journey_day_completed', {
      journey: activeJourney.id,
      day: dayNumber,
      type: day?.type,
      completed: done,
      total,
    })
    if (total > 0 && done >= total) {
      track('journey_completed', { journey: activeJourney.id, total })
    }
  }

  // --- No data yet -----------------------------------------------------------
  if (!hasData) {
    return (
      <EmptyState
        title="Your journeys are being prepared"
        message="Programmes load from journeys.json. Once they're added, you'll be able to pick a 30-day path and take it one day at a time."
      />
    )
  }

  // ── Selection view ────────────────────────────────────────────────────────
  if (!activeJourney) {
    return (
      <div className="pt-6">
        <h2 className="font-display text-[22px] font-extrabold text-navy lg:text-[26px]">
          Start a Journey
        </h2>
        <p className="mt-1 text-[14px] text-slate-500">
          Select a programme below to start your journey
        </p>

        <motion.div
          variants={listContainer}
          initial="hidden"
          animate="show"
          className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5"
        >
          {journeysData.map((journey) => (
            <motion.div key={journey.id} variants={listItem}>
              <JourneyCard journey={journey} onStart={handleStart} />
            </motion.div>
          ))}
        </motion.div>
      </div>
    )
  }

  // ── Active journey ────────────────────────────────────────────────────────
  const days = Array.isArray(activeJourney.days) ? activeJourney.days : []
  const todaysDay = days.find((d) => d.day === currentDay)
  const isFinished = completedDays.length >= days.length && days.length > 0

  return (
    <div className="pt-6">
      <JourneyHero
        journey={activeJourney}
        day={todaysDay}
        dayCount={days.length}
        finished={isFinished}
        onStart={(day) => setOpenDay(day.day)}
        onMarkDone={handleMarkDayDone}
        onOpenResource={() =>
          track('journey_resource_opened', {
            journey: activeJourney.id,
            day: todaysDay.day,
            title: todaysDay.source_title,
          })
        }
      />

      <div className="mt-7">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[20px] font-extrabold text-navy lg:text-[24px]">
            Your {activeJourney.duration_days ?? days.length}-Day Journey
          </h2>
          <span className="text-[13px] font-bold text-slate-400">
            {completedDays.length}/{days.length} done
          </span>
        </div>

        <div className="space-y-3">
          {days.map((day) => {
            const status = dayStatus(day.day, currentDay, completedDays)
            return (
              <DayCard
                key={day.day}
                day={day}
                status={status}
                expanded={openDay === day.day}
                onOpen={() => setOpenDay((d) => (d === day.day ? null : day.day))}
                onMarkDone={status === 'current' ? markDayDone : undefined}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
