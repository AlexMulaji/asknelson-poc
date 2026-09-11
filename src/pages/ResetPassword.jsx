import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword, validateResetToken } from '../lib/authApi.js'
import { track } from '../lib/analytics.js'
import { MIN_PASSWORD } from '../lib/validation.js'
import { Alert, Btn, Field, HelpFoot, Hgroup, Logo } from '../components/auth/authPrims.jsx'
import '../assets/auth/auth_style.css'

// Reset Password — the Figma frame, reached from the link in the reset SMS or
// email (/reset?token=…).
//
// The token is lifted out of the address bar as soon as the page loads, so it
// doesn't sit in browser history or end up in a screenshot. It's single use,
// expires after 30 minutes, and using it signs the account out everywhere.

export default function ResetPassword() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [token] = useState(() => params.get('token') || '')
  const [tokenState, setTokenState] = useState(token ? 'checking' : 'invalid') // checking | valid | invalid
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (params.has('token')) navigate('/reset', { replace: true })
  }, [params, navigate])

  useEffect(() => {
    if (!token) return
    let alive = true
    validateResetToken(token)
      .then((r) => alive && setTokenState(r.valid ? 'valid' : 'invalid'))
      // Can't tell (offline?): let them try; the reset call is authoritative.
      .catch(() => alive && setTokenState('valid'))
    return () => {
      alive = false
    }
  }, [token])

  async function submit(e) {
    e.preventDefault()
    const next = {}
    if (password.length < MIN_PASSWORD) next.password = `Use at least ${MIN_PASSWORD} characters.`
    if (confirmPassword !== password) next.confirmPassword = "The passwords don't match."
    setErrors(next)
    if (Object.keys(next).length) return

    setBusy(true)
    setFormError(null)
    try {
      await resetPassword(token, password)
      track('password_reset_completed', {})
      navigate('/login', {
        replace: true,
        state: { notice: { title: 'Password updated', text: 'Sign in with your new password.' } },
      })
    } catch (err) {
      if (err.status === 400 && /expired|used/i.test(err.message)) setTokenState('invalid')
      else setFormError(err.message)
      setBusy(false)
    }
  }

  const helpFoot = <HelpFoot onClick={() => navigate('/asknelson')} />

  if (tokenState === 'invalid') {
    return (
      <main className="screen screen--reset">
        <div className="screen__inner">
          <Logo />
          <Hgroup title="Reset Password" sub="This reset link can't be used." />
          <div className="body-block body-block--reset">
            <Alert
              kind="error"
              title="Link expired"
              text="Reset links work once and expire after 30 minutes. Request a new one and use the latest link we send you."
            />
            <div className="stack" style={{ gap: '21px' }}>
              <Btn label="Request a New Link" onClick={() => navigate('/forgot')} />
              {helpFoot}
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="screen screen--reset">
      <form className="screen__inner" onSubmit={submit} noValidate>
        <Logo />
        <Hgroup title="Reset Password" sub="Enter your new password below." />

        <div className="body-block body-block--reset">
          <div className="fields">
            <Field
              id="rp-pw"
              label="Password"
              hint="Enter your password"
              password
              autoComplete="new-password"
              value={password}
              error={errors.password}
              onChange={(e) => {
                setPassword(e.target.value)
                setErrors((p) => ({ ...p, password: null }))
              }}
            />
            <Field
              id="rp-pw2"
              label="Password Confirmation"
              hint="Confirm password"
              password
              autoComplete="new-password"
              value={confirmPassword}
              error={errors.confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                setErrors((p) => ({ ...p, confirmPassword: null }))
              }}
            />
          </div>

          {formError ? <Alert kind="error" title="Couldn't reset your password" text={formError} /> : null}

          <div className="stack" style={{ gap: '21px' }}>
            <Btn
              type="submit"
              label={busy ? 'Resetting' : 'Reset Password'}
              loading={busy || tokenState === 'checking'}
            />
            {helpFoot}
          </div>
        </div>
      </form>
    </main>
  )
}
