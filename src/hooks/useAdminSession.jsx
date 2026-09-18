import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AdminApiError, adminLogout, fetchAdminSession } from '../lib/adminApi.js'

// Who is signed in to the admin portal, and what they are allowed to do.
//
// `status` is the sign-in state machine, and it is the same one the server
// keeps: a session that has passed the password but not the second factor is
// real, cookie and all, and can do exactly two things.
//
//   loading             still asking the server
//   signed_out          no session
//   enrolment_required  password accepted, no second factor on the account yet
//   mfa_required        password accepted, second factor not yet presented
//   signed_in           fully authenticated
//
// `can()` mirrors the server's permission check so the UI can hide controls
// that would be refused. It is never the enforcement — every one of those
// routes checks again (see server/rbac.js).

const AdminSessionContext = createContext(null)

// Module-level so the callbacks below can close over it without listing it as
// a dependency — it is a constant, not state.
const SIGNED_OUT = { status: 'signed_out', admin: null, recoveryCodesRemaining: null, mfaEcho: false }

export function AdminSessionProvider({ children }) {
  const [state, setState] = useState({
    status: 'loading',
    admin: null,
    recoveryCodesRemaining: null,
    // Whether the server is running with ADMIN_MFA_ECHO. Only used to decide
    // whether the sign-in screen offers a code; the server still checks it.
    mfaEcho: false,
  })

  const refresh = useCallback(async () => {
    try {
      const body = await fetchAdminSession()
      setState({
        status: body.status,
        admin: body.admin,
        recoveryCodesRemaining: body.recoveryCodesRemaining ?? null,
        mfaEcho: Boolean(body.mfaEcho),
      })
      return body
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        setState(SIGNED_OUT)
        return null
      }
      throw err
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => setState(SIGNED_OUT))
  }, [refresh])

  const signOut = useCallback(async () => {
    await adminLogout().catch(() => {})
    setState(SIGNED_OUT)
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      signOut,
      can: (permission) => Boolean(state.admin?.permissions?.includes(permission)),
    }),
    [state, refresh, signOut]
  )

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>
}

export function useAdminSession() {
  const value = useContext(AdminSessionContext)
  if (!value) throw new Error('useAdminSession must be used inside an AdminSessionProvider')
  return value
}

/** Mirrors server/rbac.js. Only used to decide what to render. */
export const PERMISSIONS = {
  CONTENT_READ: 'content:read',
  CONTENT_WRITE: 'content:write',
  CONTENT_PUBLISH: 'content:publish',
  MEDIA_READ: 'media:read',
  MEDIA_WRITE: 'media:write',
  MEDIA_DELETE: 'media:delete',
  ANALYTICS_READ: 'analytics:read',
  ANALYTICS_EXPORT: 'analytics:export',
  ANALYTICS_READ_PII: 'analytics:read_pii',
  ADMIN_MANAGE: 'admin:manage',
  AUDIT_READ: 'audit:read',
}
