import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import AccountBadge from '../components/AccountBadge.jsx'
import CoverImage from '../components/CoverImage.jsx'
import PrivacyBand from '../components/PrivacyBand.jsx'
import ConfidentialityStamp from '../components/ConfidentialityStamp.jsx'
import {
  ChatIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  GridIcon,
  WellnessIcon,
} from '../components/Icons.jsx'
import { iconFor } from '../lib/iconFor.js'
import { useContent } from '../hooks/useContent.js'
import { useJourneyProgress } from '../hooks/useJourneyProgress.js'

const HERO_IMAGE = '/media/home-hero.jpg'
const MEDITATE_IMAGE = '/media/home-meditate.jpg'

// The four entry points from the V1 home screen.
const ACTIONS = [
  {
    to: '/my-wellness?tab=meditation',
    Icon: WellnessIcon,
    title: 'Start Meditating',
    short: 'Start\nMeditating',
    description: 'Take a moment to calm your mind with guided meditation.',
    cta: 'Meditate',
  },
  {
    to: '/assessments',
    Icon: ClipboardCheckIcon,
    title: 'Complete an Assessment',
    short: 'Complete\nAssessment',
    description: 'Self-assessment to better understand your mental wellbeing.',
    cta: 'Start Assessment',
  },
  {
    to: '/explore',
    Icon: GridIcon,
    title: 'Explore',
    short: 'Explore\nResources',
    description: 'Browse articles, videos, and resources to support your wellbeing.',
    cta: 'Start Exploring',
  },
  {
    to: '/asknelson',
    Icon: ChatIcon,
    title: 'Help & Support',
    short: 'Help &\nSupport',
    description: 'Get help and trusted support from qualified professionals.',
    cta: 'Get Help Now',
  },
]

export default function Home() {
  const journeysFile = useContent('journeys')
  const journeys = useMemo(() => journeysFile?.journeys ?? [], [journeysFile])
  const { activeJourneyId, currentDay } = useJourneyProgress()

  const activeJourney = journeys.find((j) => j.id === activeJourneyId) || null
  const days = Array.isArray(activeJourney?.days) ? activeJourney.days : []
  const todaysDay = days.find((d) => d.day === currentDay) || days[0] || null
  const JourneyIcon = iconFor(activeJourney?.icon)

  return (
    <div className="page-enter lg:-mx-10 lg:-mt-8">
      {/* ── Greeting hero ──────────────────────────────────────────────────── */}
      <div className="relative">
        <div className="relative h-[188px] overflow-hidden lg:h-[345px] lg:rounded-none">
          <CoverImage src={HERO_IMAGE} className="absolute inset-0 h-full w-full" />
          {/* Navy wash keeps the white greeting legible over any crop. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-navy/75"
            style={{
              background:
                'linear-gradient(100deg, rgba(1,36,59,0.92) 0%, rgba(1,36,59,0.72) 45%, rgba(1,36,59,0.55) 100%)',
            }}
          />
          <div className="absolute inset-x-0 top-0 px-5 pt-[calc(1.75rem+env(safe-area-inset-top,0px))] lg:px-10 lg:pt-12">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display text-[28px] font-extrabold leading-tight text-white lg:text-[38px]">
                  Welcome
                </h1>
                <p className="mt-2 hidden max-w-sm text-[15px] leading-relaxed text-white/85 lg:block">
                  Start your journey to better wellbeing and build healthier habits.
                </p>
              </div>
              {/* Sign in (or the signed-in chip) on mobile; desktop has it in the sidebar. */}
              <AccountBadge className="shrink-0 lg:hidden" />
            </div>
          </div>
        </div>

        {/* ── Continue your journey ────────────────────────────────────────── */}
        <div className="relative -mt-16 px-5 lg:-mt-24 lg:px-10">
          {activeJourney && todaysDay ? (
            <div className="rounded-card bg-white p-5 shadow-card lg:p-7">
              <h2 className="font-display text-[17px] font-extrabold text-navy lg:hidden">
                Continue Your Journey
              </h2>
              <div className="mt-3 flex flex-col gap-4 lg:mt-0 lg:flex-row lg:items-center lg:gap-6">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-btn bg-brand-tint text-brand lg:h-16 lg:w-16">
                  <JourneyIcon className="h-7 w-7" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold text-brand">Day {todaysDay.day}</p>
                  <h3 className="mt-0.5 font-display text-[19px] font-extrabold leading-snug text-navy lg:text-[22px]">
                    {todaysDay.title}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">
                    {todaysDay.task}
                  </p>
                </div>
                <Link
                  to="/my-wellness"
                  className="grid min-h-[48px] shrink-0 place-items-center rounded-btn bg-brand px-7 text-[15px] font-extrabold text-white transition hover:bg-brand-dark active:scale-[0.98]"
                >
                  Continue Journey
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-card bg-white p-5 shadow-card lg:p-7">
              <h2 className="font-display text-[17px] font-extrabold text-navy lg:text-[20px]">
                Start Your Journey
              </h2>
              <p className="mt-1.5 text-[14px] leading-relaxed text-slate-500">
                Pick a 30-day programme and take it one day at a time.
              </p>
              <Link
                to="/my-wellness"
                className="mt-4 grid min-h-[48px] w-full place-items-center rounded-btn bg-brand px-7 text-[15px] font-extrabold text-white transition hover:bg-brand-dark active:scale-[0.98] lg:w-auto lg:max-w-[240px]"
              >
                Choose a Journey
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick actions ──────────────────────────────────────────────────── */}
      <section className="px-5 pt-7 lg:px-10 lg:pt-10">
        <h2 className="font-display text-[20px] font-extrabold text-navy lg:text-[24px]">
          What would you like to do?
        </h2>

        {/* Mobile: the meditation entry point is a full-bleed image card. */}
        <Link
          to="/my-wellness?tab=meditation"
          className="card-press relative mt-4 block overflow-hidden rounded-card lg:hidden"
        >
          <CoverImage src={MEDITATE_IMAGE} className="h-[150px] w-full" />
          <div aria-hidden className="absolute inset-0 bg-navy/60" />
          <div className="absolute inset-0 flex flex-col justify-center px-5">
            <p className="font-display text-[20px] font-extrabold text-white">Start Meditating</p>
            <p className="mt-1 text-[14px] text-white/85">Take a mindful break.</p>
          </div>
          <span className="absolute bottom-4 right-4 grid h-9 w-9 place-items-center rounded-full bg-brand text-white">
            <ChevronRightIcon className="h-5 w-5" />
          </span>
        </Link>

        {/* Mobile: the remaining three as compact tiles. */}
        <div className="mt-3 grid grid-cols-3 gap-3 lg:hidden">
          {ACTIONS.filter((a) => a.title !== 'Start Meditating').map(({ to, Icon, short, title }) => (
            <Link
              key={to}
              to={to}
              className="card-press flex flex-col items-center gap-2.5 rounded-card border border-line bg-white px-2 py-4 text-center"
            >
              <Icon className="h-7 w-7 text-brand" />
              <span className="whitespace-pre-line text-[12px] font-extrabold leading-tight text-navy">
                {short ?? title}
              </span>
            </Link>
          ))}
        </div>

        {/* Desktop: all four as equal cards. */}
        <div className="mt-5 hidden gap-5 lg:grid lg:grid-cols-4">
          {ACTIONS.map(({ to, Icon, title, description, cta }) => (
            <Link
              key={to}
              to={to}
              className="card-press flex flex-col rounded-card border border-line bg-white p-5"
            >
              <span className="grid h-12 w-12 place-items-center rounded-btn bg-brand-tint text-brand">
                <Icon className="h-6 w-6" />
              </span>
              <h3 className="mt-4 font-display text-[18px] font-extrabold leading-snug text-navy">
                {title}
              </h3>
              <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-slate-500">
                {description}
              </p>
              <span className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-extrabold text-brand">
                {cta} <span aria-hidden>→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Mobile keeps the stamp; desktop gets the full privacy band from App. */}
      <div className="px-5 pb-8 pt-7 lg:hidden">
        <PrivacyBand />
        <div className="mt-5 flex justify-center">
          <ConfidentialityStamp imgClassName="max-w-[150px] opacity-90" />
        </div>
      </div>
    </div>
  )
}
