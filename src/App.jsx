import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import BottomNav from './components/BottomNav.jsx'
import Sidebar from './components/Sidebar.jsx'
import PrivacyBand from './components/PrivacyBand.jsx'
import Home from './pages/Home.jsx'
import MyWellness from './pages/MyWellness.jsx'
import Explore from './pages/Explore.jsx'
import Assessments from './pages/Assessments.jsx'
import AssessmentFlow from './pages/AssessmentFlow.jsx'
import AskNelson from './pages/AskNelson.jsx'
import Admin from './pages/Admin.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Meditate from './pages/Meditate.jsx'
import Journeys from './pages/Journeys.jsx'
import Reset from './pages/ResetPassword.jsx'
import Forgot from './pages/ForgotPassword.jsx'
import InAppBrowser from './components/InAppBrowser.jsx'
import { useAuth } from './hooks/useAuth.jsx'
import {
  getNotificationPreference,
  requestNotificationPermission,
} from './services/NotificationService.js'
import { track } from './lib/analytics.js'
import { pushLastRoute } from './lib/progressSync.js'

// Scroll the page back to the top whenever the user switches tabs.
function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])
  return null
}

// Redirect that keeps the original query string, so deep links built before the
// V1 route rename (/journeys?journey=grief, /meditate) still land correctly.
function RedirectWithQuery({ to, addQuery }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (addQuery) {
    for (const [k, v] of Object.entries(addQuery)) if (!params.has(k)) params.set(k, v)
  }
  const qs = params.toString()
  return <Navigate to={qs ? `${to}?${qs}` : to} replace />
}

// One page_view per client-side navigation, including the first render. When
// signed in, the route is also saved as where the member left off, so signing
// in on another device resumes there (sign-in screens are never saved).
function RouteTracker() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    track('page_view', { path: pathname })
  }, [pathname])
  useEffect(() => {
    pushLastRoute(pathname + search)
  }, [pathname, search])
  return null
}

export default function App() {
  const { pathname, search } = useLocation()
  const { status, isSignedIn } = useAuth()
  // The admin console lives outside the member-facing shell.
  const isAdmin = pathname.startsWith('/admin')
  // Taking an assessment is a full-screen task: the mockups drop the nav so the
  // member isn't invited to wander off mid-questionnaire.
  const isImmersive = /^\/assessments\/[^/]+$/.test(pathname)
  // Sign-in and registration are full-screen too: a nav bar during sign-up
  // invites people to wander off mid-flow.
  const isAuth = pathname === '/login' || pathname === '/reset' || pathname === '/forgot' || pathname.startsWith('/register')

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

  if (isImmersive) {
    return (
      <MotionConfig reducedMotion="user">
        <ScrollToTop />
        <Routes>
          <Route path="/assessments/:id" element={<AssessmentFlow />} />
        </Routes>
      </MotionConfig>
    )
  }

  if (isAuth) {
    return (
      <MotionConfig reducedMotion="user">
        <ScrollToTop />
        <RouteTracker />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/reset" element={<Reset />} />
          <Route path="/forgot" element={<Forgot />} />
        </Routes>
      </MotionConfig>
    )
  }

  // Everything past this point needs an account. Wait for /me rather than
  // flashing the sign-in screen at someone who is already signed in, then send
  // signed-out visitors to /login, remembering where they were headed.
  if (status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-canvas">
        <span
          role="status"
          aria-label="Loading"
          className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand border-t-transparent"
        />
      </div>
    )
  }

  if (!isSignedIn) {
    return <Navigate to="/login" replace state={{ from: pathname + search }} />
  }

  return (
    // Mobile: a single column. Desktop (lg+): a flex row with a fixed sidebar
    // on the left and a wide, centered content column on the right.
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen bg-canvas lg:flex lg:bg-white">
      <ScrollToTop />
      <RouteTracker />
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
          <div className="mx-auto w-full max-w-md lg:max-w-content lg:px-10 lg:pt-8">
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={<Home />} />
              <Route path="/my-wellness" element={<MyWellness />} />
              <Route path="/assessments" element={<Assessments />} />
              <Route path="/explore" element={<Explore />} />
              <Route path="/journeys" element={<Journeys />} />
              <Route path="/assessments" element={<Assessments />} />
              <Route path="/assessments/:id" element={<AssessmentFlow />} />
              <Route path="/meditate" element={<Meditate />} />
              <Route path="/asknelson" element={<AskNelson />} />
              {/* Pre-V1 routes, kept working. */}
              <Route path="/journeys" element={<RedirectWithQuery to="/my-wellness" />} />
              <Route
                path="/meditate"
                element={<RedirectWithQuery to="/my-wellness" addQuery={{ tab: 'meditation' }} />}
              />

              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
            {/* Desktop-only reassurance band, shown on every member screen. */}
            <div className="hidden px-0 pb-10 pt-4 lg:block">
              <PrivacyBand />
            </div>
          </div>
        </main>
      </div>
      <BottomNav />
      {/* External articles, videos and booking open over the current page. */}
      <InAppBrowser />
    </div>
    </MotionConfig>
  )
}
