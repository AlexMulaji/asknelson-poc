import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Field,
  FormError,
  PasswordField,
  PrimaryButton,
} from '../components/auth/formControls.jsx'
import { useAuth } from '../hooks/useAuth.jsx'
import logoUrl from '../assets/logo-asknelson.png'

// Sign in. Copy follows the Figma sign-in frame ("Please enter your details
// below to sign in.", Remember me, Forgot Password?, Sign Up link).
//
// The identifier field accepts a username, email or cell number. Anonymous
// accounts have no stored email or phone, but their peppered hashes still
// resolve — so someone who registered anonymously can sign in with the address
// they verified even though we no longer hold it.

export default function Login() {
  const navigate = useNavigate()
  const { signIn } = useAuth()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!identifier.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      await signIn(identifier.trim(), password)
      navigate('/explore')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page-enter flex min-h-screen flex-col bg-canvas">
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-10 pt-[calc(3rem+env(safe-area-inset-top,0px))]">
        <img src={logoUrl} alt="AskNelson" className="h-9 w-auto" />

        <h1 className="mt-8 font-display text-[26px] font-semibold leading-tight text-black">
          Welcome back
        </h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-gray-500">
          Please enter your details below to sign in.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
          <Field
            label="Username, email or cell number"
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value)
              setError(null)
            }}
            autoComplete="username"
            autoCapitalize="none"
            placeholder="you@example.co.za"
          />

          <PasswordField
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            autoComplete="current-password"
            placeholder="Enter your password"
          />

          <div className="flex items-center justify-between">
            <label className="flex cursor-pointer items-center gap-2 py-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 accent-[#172B5C]"
              />
              <span className="text-[13px] text-gray-600">Remember me</span>
            </label>
            <Link
              to="/register"
              className="py-2 text-[13px] font-semibold text-brand"
              // Password reset isn't built yet; registering again with the same
              // contact details is the honest route until it is.
              title="Password reset is coming — register again or contact support"
            >
              Forgot password?
            </Link>
          </div>

          <FormError>{error}</FormError>

          <PrimaryButton type="submit" busy={busy} disabled={!identifier.trim() || !password}>
            Sign in
          </PrimaryButton>
        </form>

        <p className="mt-6 text-center text-[13px] text-gray-500">
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-brand">
            Sign up
          </Link>
        </p>

        <p className="mt-2 text-center text-[13px] text-gray-400">
          Or{' '}
          <Link to="/explore" className="font-semibold text-gray-500 underline">
            keep browsing
          </Link>{' '}
          — an account is optional.
        </p>
      </main>
    </div>
  )
}
