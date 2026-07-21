import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import BottomNav from './components/BottomNav.jsx'
import Sidebar from './components/Sidebar.jsx'
import ConfidentialityStamp from './components/ConfidentialityStamp.jsx'
import LinkGate from './components/LinkGate.jsx'
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
import { getSessionId, linkWithToken } from './lib/authApi.js'
import { trackEvent } from './services/EventTracker.js'

// Scroll the page back to the top whenever the user switches tabs, and log a
// page view for the member behind the current session (no-ops if unlinked).
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    trackEvent('page_view')
  }, [pathname])
  return null
}

export default function App() {
  // The admin console lives outside the member-facing shell — no sidebar,
  // bottom nav, phone-width column, or WhatsApp-link gate. It has its own
  // password gate (see pages/Admin.jsx).
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const isAdmin = pathname.startsWith('/admin')

  // 'checking' -> 'linked' | 'blocked'. A `?t=<token>` in the URL (the
  // WhatsApp link) is exchanged for a session once; after that, a session id
  // already in localStorage is trusted without a network round-trip so the
  // installed PWA keeps working offline.
  const [authState, setAuthState] = useState(() => (getSessionId() ? 'linked' : 'checking'))

  useEffect(() => {
    if (isAdmin) return
    const params = new URLSearchParams(search)
    const token = params.get('t')
    if (!token) {
      setAuthState(getSessionId() ? 'linked' : 'blocked')
      return
    }
    linkWithToken(token)
      .then(() => {
        // Strip the token from the URL/history so it doesn't linger in a
        // browser history entry or a screenshot.
        params.delete('t')
        const rest = params.toString()
        navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true })
        setAuthState('linked')
      })
      .catch(() => setAuthState('blocked'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, search])

  // After first load, gently ask for notification permission once (after 5s).
  useEffect(() => {
    if (isAdmin || authState !== 'linked') return
    if (getNotificationPreference()) return
    const timer = window.setTimeout(() => {
      requestNotificationPermission()
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [isAdmin, authState])

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

  // Not linked to a member yet. 'checking' briefly covers the token-exchange
  // round trip; render nothing but the canvas colour to avoid a white flash.
  if (authState !== 'linked') {
    return authState === 'blocked' ? <LinkGate /> : <div className="min-h-screen bg-canvas" />
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
