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
