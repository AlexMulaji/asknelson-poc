import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import BottomNav from './components/BottomNav.jsx'
import Sidebar from './components/Sidebar.jsx'
import ConfidentialityStamp from './components/ConfidentialityStamp.jsx'
import Explore from './pages/Explore.jsx'
import Journeys from './pages/Journeys.jsx'
import Assessments from './pages/Assessments.jsx'
import AssessmentFlow from './pages/AssessmentFlow.jsx'
import Meditate from './pages/Meditate.jsx'
import AskNelson from './pages/AskNelson.jsx'
import Admin from './pages/Admin.jsx'
import {
  getNotificationPreference,
  requestNotificationPermission,
} from './services/NotificationService.js'

// Scroll the page back to the top whenever the user switches tabs.
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

export default function App() {
  // The admin console lives outside the member-facing shell — no sidebar,
  // bottom nav, or phone-width column.
  const { pathname } = useLocation()
  const isAdmin = pathname.startsWith('/admin')

  // After first load, gently ask for notification permission once (after 5s).
  useEffect(() => {
    if (getNotificationPreference()) return
    const timer = window.setTimeout(() => {
      requestNotificationPermission()
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [])

  if (isAdmin) {
    return (
      <MotionConfig reducedMotion="user">
        <ScrollToTop />
        <Routes>
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </MotionConfig>
    )
  }

  return (
    // Mobile: a single column. Desktop (lg+): a flex row with a fixed sidebar
    // on the left and a wide, centered content column on the right.
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-canvas lg:flex">
      <ScrollToTop />
      <Sidebar />
      {/* Content column. min-w-0 lets it shrink correctly beside the sidebar;
          overflow-x-hidden contains horizontally-scrolling rows (chips, etc.). */}
      <div className="flex w-full min-w-0 flex-col overflow-x-hidden">
        <main
          className="flex-1"
          // Use the CSS variable so padding dynamically includes the device safe
          // area — covers notched iPhones, Android gesture bars, etc. On desktop
          // the variable resolves to 0 (no bottom nav) via a media query in CSS.
          style={{ paddingBottom: 'var(--bottom-clearance)' }}
        >
          {/* Phone-width column on mobile; widens to a roomy desktop column. */}
          <div className="mx-auto w-full max-w-md lg:max-w-5xl">
            <Routes>
              <Route path="/" element={<Navigate to="/explore" replace />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/journeys" element={<Journeys />} />
              <Route path="/assessments" element={<Assessments />} />
              <Route path="/assessments/:id" element={<AssessmentFlow />} />
              <Route path="/meditate" element={<Meditate />} />
              <Route path="/asknelson" element={<AskNelson />} />
              <Route path="*" element={<Navigate to="/explore" replace />} />
            </Routes>
          </div>

          {/* Persistent confidentiality stamp — shown on every route. On desktop
              it lives in the sidebar instead, so this footer is mobile/tablet only. */}
          <footer className="mx-auto flex max-w-md justify-center px-5 pt-2 pb-6 lg:hidden">
            <ConfidentialityStamp imgClassName="max-w-[150px] opacity-90" />
          </footer>
        </main>
      </div>
      <BottomNav />
    </div>
    </MotionConfig>
  )
}
