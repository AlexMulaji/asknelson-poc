import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '../lib/authApi.js'
import { track } from '../lib/analytics.js'

// Signed-in state for the whole app.
//
// Accounts are optional here by design: a WhatsApp tap should land straight in
// the content, not on a wall. So `user === null` is a normal, fully-supported
// state and nothing in the shell blocks on it.

const AuthContext = createContext(null)

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

  const signIn = useCallback(async (identifier, password) => {
    const data = await api.login(identifier, password)
    setUser(data.user)
    // Anonymous accounts are deliberately not distinguished any further than
    // this flag — no id, nothing that could re-identify them.
    track('signed_in', { anonymous: Boolean(data.user?.isAnonymous) })
    return data.user
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      track('signed_out', {})
    }
  }, [])

  // Called by the registration flow once the PIN is verified.
  const adoptUser = useCallback((next) => {
    setUser(next)
    track('registered', { anonymous: Boolean(next?.isAnonymous) })
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
