import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import JourneyCard from '../components/JourneyCard.jsx'
import DayCard from '../components/DayCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { motion } from 'framer-motion'
import { listContainer, listItem } from '../lib/motion.js'
import { meshGradient } from '../lib/colorUtils.js'
import { useJourneyProgress } from '../hooks/useJourneyProgress.js'
import { useContent } from '../hooks/useContent.js'
import { track } from '../lib/analytics.js'

function dayStatus(dayNumber, currentDay, completedDays) {
  if (completedDays.includes(dayNumber)) return 'completed'
  if (dayNumber === currentDay) return 'current'
  if (dayNumber < currentDay) return 'completed'
  return 'locked'
}

export default function Journeys() {
  // Data shape: { journeys: [ { id, title, description, color, days: [...] } ] }
  const journeysFile = useContent('journeys')
  const journeysData = useMemo(() => journeysFile?.journeys ?? [], [journeysFile])

  const {
    activeJourneyId,
    completedDays,
    currentDay,
    startJourney,
    switchJourney,
    markDayDone,
  } = useJourneyProgress()

  const [pendingSwitch, setPendingSwitch] = useState(null) // journeyId awaiting confirm
  const [searchParams, setSearchParams] = useSearchParams()

  const activeJourney = useMemo(
    () => journeysData.find((j) => j.id === activeJourneyId) || null,
    [activeJourneyId, journeysData]
  )

  // Deep link from an assessment CTA: /journeys?journey=<id> opens that journey
  // (preserving any saved progress), then clears the param.
  const journeyParam = searchParams.get('journey')
  useEffect(() => {
    if (journeyParam && journeysData.some((j) => j.id === journeyParam)) {
      switchJourney(journeyParam)
      setSearchParams({}, { replace: true })
    }
  }, [journeyParam, switchJourney, setSearchParams, journeysData])

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
      <div>
        <PageHeader title="Your Journey" subtitle="30-day programmes for real life" />
        <EmptyState
          title="Your journeys are being prepared"
          message="Programmes load from journeys.json. Once they're added, you'll be able to pick a 30-day path and take it one day at a time."
        />
      </div>
    )
  }

  // --- No active journey: selection view ------------------------------------
  if (!activeJourney) {
    return (
      <div className="page-enter">
        <PageHeader title="Your Journey" subtitle="30-day programmes for real life" />
        <motion.div
          variants={listContainer}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 gap-4 px-5 pt-4 pb-6 lg:grid-cols-2 lg:gap-5"
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

  // --- Active journey: progress view ----------------------------------------
  const days = Array.isArray(activeJourney.days) ? activeJourney.days : []
  const color = activeJourney.color || '#172B5C'
  const todaysDay = days.find((d) => d.day === currentDay)
  const isFinished = completedDays.length >= days.length && days.length > 0

  return (
    <div className="page-enter">
      <PageHeader title="Your Journey" subtitle={activeJourney.title} />

      <div className="space-y-5 px-5 pb-6">
        {/* Current day, prominent */}
        {isFinished ? (
          <div className="rounded-hero p-7 text-center" style={{ background: meshGradient(color) }}>
            <p className="font-display text-[24px] font-semibold text-black">
              You did it — all {days.length} days.
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
              That's real commitment to yourself. Take a moment to feel good about it.
            </p>
          </div>
        ) : todaysDay ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Today
            </p>
            <DayCard
              day={todaysDay}
              status="current"
              color={color}
              onMarkDone={handleMarkDayDone}
              onOpenResource={() =>
                track('journey_resource_opened', {
                  journey: activeJourney.id,
                  day: todaysDay.day,
                  title: todaysDay.source_title,
                })
              }
              prominent
            />
          </div>
        ) : null}

        {/* Full 30-day list */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              All days
            </p>
            <span className="text-xs text-gray-400">
              {completedDays.length}/{days.length} done
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {days.map((day) => (
              <DayCard
                key={day.day}
                day={day}
                status={dayStatus(day.day, currentDay, completedDays)}
                color={color}
              />
            ))}
          </div>
        </div>

        {/* Switch journey */}
        <div className="pt-2">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Switch journey
          </p>
          <div className="space-y-2">
            {journeysData
              .filter((j) => j.id !== activeJourneyId)
              .map((j) => (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => setPendingSwitch(j.id)}
                  className="w-full rounded-btn border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-700 transition active:scale-[0.99]"
                >
                  {j.title}
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {pendingSwitch ? (
        <SwitchModal
          journey={journeysData.find((j) => j.id === pendingSwitch)}
          onCancel={() => setPendingSwitch(null)}
          onConfirm={() => {
            switchJourney(pendingSwitch)
            track('journey_switched', { from: activeJourneyId, to: pendingSwitch })
            setPendingSwitch(null)
          }}
        />
      ) : null}
    </div>
  )
}

function SwitchModal({ journey, onCancel, onConfirm }) {
  return (
    // Sheet slides up from the bottom — natural on mobile.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-t-[20px] bg-white px-6 pt-5 pb-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-gray-200" aria-hidden />

        <h2 className="text-[17px] font-bold text-black">Switch to {journey?.title}?</h2>
        <p className="mt-2 text-[14px] leading-relaxed text-gray-500">
          You can only follow one journey at a time. Your current progress will be saved, so you
          can always come back to it later.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-[48px] rounded-btn border border-gray-200
                       text-[14px] font-semibold text-gray-600 active:bg-gray-50"
          >
            Stay here
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 min-h-[48px] rounded-btn bg-brand
                       text-[14px] font-semibold text-white active:opacity-90"
          >
            Switch
          </button>
        </div>
      </div>
    </div>
  )
}
