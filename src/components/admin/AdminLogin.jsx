import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  adminLogin,
  completeTotpEnrolment,
  fetchMfaEcho,
  startTotpEnrolment,
  submitMfaCode,
} from '../../lib/adminApi.js'
import { useAdminSession } from '../../hooks/useAdminSession.jsx'

// Admin sign-in, in as many steps as the account needs:
//
//   password -> code                     an enrolled admin
//   password -> set up an app -> code    a new admin, or one whose second
//                                        factor was reset after losing a phone
//
// The second factor is not optional and cannot be postponed: an account
// without one can do nothing but enrol.

const card = 'w-full max-w-sm rounded-2xl border border-gray-200 bg-surface p-7 shadow-sm'
const input =
  'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand focus:outline-none'
const primary =
  'mt-5 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-on-brand transition disabled:opacity-40'

function Shell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <div className={card}>
        <h1 className="font-display text-[22px] font-bold text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm leading-relaxed text-gray-500">{subtitle}</p> : null}
        {children}
        <Link
          to="/explore"
          className="mt-4 block text-center text-xs text-gray-400 hover:text-gray-600"
        >
          ← Back to the app
        </Link>
      </div>
    </div>
  )
}

function Error({ children }) {
  return children ? <p className="mt-3 text-sm text-red-600">{children}</p> : null
}

/**
 * Demo mode: shows the code an authenticator app would be showing, so the
 * portal can be set up on a machine without one.
 *
 * Only ever rendered when the server has `ADMIN_MFA_ECHO=true` — `initial` is
 * null and the fetch 404s otherwise, so this disappears entirely rather than
 * degrading into an empty box. It is styled as a warning on purpose: a demo
 * affordance that looks like a normal part of the product is one nobody
 * remembers to turn off.
 *
 * The code rolls over every 30 seconds, so it re-fetches when its countdown
 * runs out rather than leaving a stale number on screen for someone to type.
 */
function DemoCode({ initial, onUse }) {
  const [echo, setEcho] = useState(initial ?? null)
  const [remaining, setRemaining] = useState(initial?.expiresInSeconds ?? 0)

  useEffect(() => {
    if (!echo) return undefined
    if (remaining > 0) {
      const timer = setTimeout(() => setRemaining((r) => r - 1), 1000)
      return () => clearTimeout(timer)
    }
    let alive = true
    fetchMfaEcho()
      .then((next) => {
        if (!alive) return
        setEcho(next)
        setRemaining(next.expiresInSeconds)
      })
      .catch(() => {
        // The flag was turned off under us, which is the good outcome.
        if (alive) setEcho(null)
      })
    return () => {
      alive = false
    }
  }, [echo, remaining])

  if (!echo) return null

  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
        Demo mode — two-factor is not protecting this portal
      </p>
      <div className="mt-2 flex items-center gap-3">
        <span className="font-mono text-[22px] font-bold tracking-[0.2em] text-amber-900">
          {echo.code}
        </span>
        <span className="text-[11px] text-amber-700">expires in {remaining}s</span>
        <button
          type="button"
          onClick={() => onUse(echo.code)}
          className="ml-auto rounded-md border border-amber-400 bg-surface px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          Use this code
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
        The server is running with <code>ADMIN_MFA_ECHO=true</code>, which hands the second factor
        to anyone who knows the password. Unset it before real admins use this.
      </p>
    </div>
  )
}

// --- step 1: password -----------------------------------------------------------

function PasswordStep({ onDone }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await adminLogin(email.trim(), password)
      // Not signed in yet — the cookie now holds a session that can only
      // enrol or present a second factor.
      onDone(result.status)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="Admin" subtitle="Sign in to manage content and reporting.">
      <form onSubmit={submit}>
        <label className="mt-5 block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Email address</span>
          <input
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={input}
          />
        </label>
        <Error>{error}</Error>
        <button type="submit" disabled={busy || !email || !password} className={primary}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </Shell>
  )
}

// --- step 2a: enrol a second factor ----------------------------------------------

function EnrolStep({ onDone }) {
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    startTotpEnrolment()
      .then(setSetup)
      .catch((err) => setError(err.message))
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await completeTotpEnrolment(code)
      // Shown exactly once — only their hashes are stored.
      onDone(result.recoveryCodes)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title="Set up two-factor"
      subtitle="Add this account to an authenticator app (Google Authenticator, 1Password, Authy), then enter the code it shows."
    >
      {setup ? (
        <>
          <div className="mt-4 rounded-lg bg-gray-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Setup key
            </p>
            <p className="mt-1 break-all font-mono text-[13px] font-semibold text-gray-800">
              {setup.secretFormatted}
            </p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(setup.otpauthUri)
                setCopied(true)
              }}
              className="mt-2 rounded-md border border-gray-200 bg-surface px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              {copied ? 'Setup link copied' : 'Copy setup link'}
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
              Type the key in by hand, or paste the setup link into your authenticator app.
            </p>
          </div>

          <DemoCode initial={setup.echo} onUse={setCode} />

          <form onSubmit={submit}>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">
                6-digit code from the app
              </span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${input} font-mono tracking-[0.3em]`}
              />
            </label>
            <Error>{error}</Error>
            <button type="submit" disabled={busy || code.length !== 6} className={primary}>
              {busy ? 'Checking…' : 'Turn on two-factor'}
            </button>
          </form>
        </>
      ) : (
        <>
          <Error>{error}</Error>
          {!error ? <p className="mt-6 text-sm text-gray-400">Preparing your setup key…</p> : null}
        </>
      )}
    </Shell>
  )
}

// --- step 2b: present the second factor ------------------------------------------

function CodeStep({ onDone, demo }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [echo, setEcho] = useState(null)

  // The enrolment step already has a code from its setup response; this one has
  // to ask. A failure means demo mode is off, so nothing is rendered.
  //
  // DemoCode seeds its own state from `initial` on mount and then refreshes
  // itself, so it must not be mounted before the first code has arrived — see
  // the guarded render below.
  useEffect(() => {
    if (!demo) return undefined
    let alive = true
    fetchMfaEcho()
      .then((next) => alive && setEcho(next))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [demo])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await submitMfaCode(code.trim())
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell
      title="Enter your code"
      subtitle="Open your authenticator app and enter the current 6-digit code. Lost your phone? Use one of your recovery codes instead."
    >
      {echo ? <DemoCode initial={echo} onUse={setCode} /> : null}

      <form onSubmit={submit}>
        <label className="mt-5 block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">
            Authenticator or recovery code
          </span>
          <input
            autoFocus
            inputMode="text"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={`${input} font-mono tracking-widest`}
          />
        </label>
        <Error>{error}</Error>
        <button type="submit" disabled={busy || code.trim().length < 6} className={primary}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </Shell>
  )
}

// --- recovery codes, shown once --------------------------------------------------

export function RecoveryCodes({ codes, onDone }) {
  const [acknowledged, setAcknowledged] = useState(false)
  return (
    <Shell
      title="Save your recovery codes"
      subtitle="Each one signs you in once if you lose your phone. They are not stored anywhere you can read them again — print them or put them in a password manager now."
    >
      <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-lg bg-gray-50 p-3 font-mono text-[13px] text-gray-800">
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(codes.join('\n'))
          setAcknowledged(true)
        }}
        className="mt-3 w-full rounded-lg border border-gray-200 bg-surface py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
      >
        Copy all
      </button>
      <label className="mt-3 flex items-start gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5"
        />
        I have saved these somewhere safe.
      </label>
      <button type="button" disabled={!acknowledged} onClick={onDone} className={primary}>
        Continue to the portal
      </button>
    </Shell>
  )
}

/**
 * Drives whichever step the session is on. `status` comes from the server, so
 * a reload in the middle of sign-in resumes where it left off rather than
 * starting over.
 */
export default function AdminLogin() {
  const { status, mfaEcho, refresh } = useAdminSession()
  const [newCodes, setNewCodes] = useState(null)

  if (newCodes) {
    return <RecoveryCodes codes={newCodes} onDone={() => refresh()} />
  }

  if (status === 'enrolment_required') {
    return <EnrolStep onDone={setNewCodes} />
  }

  if (status === 'mfa_required') {
    return <CodeStep demo={mfaEcho} onDone={() => refresh()} />
  }

  return <PasswordStep onDone={() => refresh()} />
}
