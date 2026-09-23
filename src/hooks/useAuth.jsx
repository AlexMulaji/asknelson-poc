import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/authApi.js'
import { track } from '../lib/analytics.js'
import { clearLocalProgress, setSyncEnabled, syncOnSignIn } from '../lib/progressSync.js'

// Signed-in state for the whole app.
//
// Accounts are optional here by design: a WhatsApp tap should land straight in
// the content, not on a wall. So `user === null` is a normal, fully-supported
// state and nothing in the shell blocks on it.
//
// Signing in also restores the member's saved progress (journeys, assessment
// history, meditation settings) onto this device, and signing out removes it.

const AuthContext = createContext(null)

// Kept in sync with the server's AUTH_IDLE_TIMEOUT_MINUTES default
// (server/session.js) — the server is the real enforcement, this just signs
// out an open tab immediately instead of waiting for its next API call.
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000
const LAST_ACTIVITY_KEY = 'asknelson.lastActivityAt'
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']

// Never throws: Safari private mode, WhatsApp webviews, etc.
function readLastActivity() {
  try {
    return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now()
  } catch {
    return Date.now()
  }
}

function writeLastActivity(at) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at))
  } catch {
    /* quota or privacy mode */
  }
}

// Signs `signOut` out after IDLE_TIMEOUT_MS with no activity in any tab.
// Last-activity is shared via localStorage so one active tab keeps a
// backgrounded one signed in, and a tab that was closed/idle picks up the
// real elapsed time (not just its own idle clock) when it's next focused.
function useIdleTimeout(active, signOut) {
  useEffect(() => {
    if (!active) return undefined

    let timer = null

    const scheduleFromLastActivity = () => {
      const elapsed = Date.now() - readLastActivity()
      if (elapsed >= IDLE_TIMEOUT_MS) {
        signOut()
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(scheduleFromLastActivity, IDLE_TIMEOUT_MS - elapsed)
    }

    const onActivity = () => {
      writeLastActivity(Date.now())
      window.clearTimeout(timer)
      timer = window.setTimeout(scheduleFromLastActivity, IDLE_TIMEOUT_MS)
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleFromLastActivity()
    }

    writeLastActivity(Date.now())
    scheduleFromLastActivity()
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearTimeout(timer)
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, signOut])
}

// Pull the account's progress onto this device (merging anything made while
// signed out). Resolves to the route the member was last on, or null.
async function restoreProgress() {
  try {
    const snapshot = await syncOnSignIn()
    track('progress_restored', {
      journeys: Object.keys(snapshot.journeys ?? {}).length,
      assessments: Object.keys(snapshot.assessments ?? {}).length,
    })
    return snapshot.app?.lastRoute ?? null
  } catch {
    // Offline or a server hiccup: local progress still works, and the outbox
    // catches the account up once the connection is back.
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // 'loading' until /me answers, so the UI doesn't flash "Sign in" at someone
  // who is already signed in.
  const [status, setStatus] = useState('loading')
  // True when the server has no database — sign-in is unavailable and the UI
  // should hide the entry points rather than offer something that will fail.
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let alive = true
    api
      .fetchMe()
      .then((data) => {
        if (!alive) return
        setUser(data?.user ?? null)
        setStatus('ready')
        // A returning member: pick up anything saved from another device.
        if (data?.user) syncOnSignIn().catch(() => setSyncEnabled(true))
      })
      .catch((err) => {
        if (!alive) return
        if (err.status === 503) setUnavailable(true)
        setUser(null)
        setStatus('ready')
      })
    return () => {
      alive = false
    }
  }, [])

  /** Resolves to { user, lastRoute } — lastRoute is where they left off. */
  const signIn = useCallback(async (identifier, password, remember = true) => {
    const data = await api.login(identifier, password, remember)
    setUser(data.user)
    // Anonymous accounts are deliberately not distinguished any further than
    // this flag — no id, nothing that could re-identify them.
    track('signed_in', { anonymous: Boolean(data.user?.isAnonymous), remember })
    const lastRoute = await restoreProgress()
    return { user: data.user, lastRoute }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      // Shared phones are common: the next person mustn't see this progress.
      clearLocalProgress()
      track('signed_out', {})
    }
  }, [])

  useIdleTimeout(Boolean(user), signOut)

  // Called by the registration flow once the code is verified. Anything done
  // before signing up is saved to the new account.
  const adoptUser = useCallback(async (next) => {
    setUser(next)
    track('registered', { anonymous: Boolean(next?.isAnonymous) })
    await restoreProgress()
  }, [])

  const value = useMemo(
    () => ({
      user,
      status,
      unavailable,
      isSignedIn: Boolean(user),
      isAnonymous: Boolean(user?.isAnonymous),
      signIn,
      signOut,
      adoptUser,
    }),
    [user, status, unavailable, signIn, signOut, adoptUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider')
  return ctx
}
