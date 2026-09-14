import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'
import { track } from '../lib/analytics.js'
import { Alert, Btn, Check, Field, Hgroup, Logo } from '../components/auth/authPrims.jsx'
import '../assets/auth/auth_style.css'

// Sign in — the Figma "Login" frame.
//
// The field is labelled Mobile Number, as designed; the server also accepts an
// email address or, for anonymous accounts, a username. "Remember Me" unticked
// gives a session that ends with the browser (and after 12 hours at most).
// On success the member lands where they left off, on whichever device that was.

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn, unavailable } = useAuth()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Set by the reset screen: "Password updated — sign in with your new one."
  const notice = location.state?.notice

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!identifier.trim() || !password) {
      setError('Enter your mobile number and password.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { lastRoute } = await signIn(identifier.trim(), password, remember)
      // Where they were going before the gate, else where they left off.
      navigate(location.state?.from || lastRoute || '/home', { replace: true })
    } catch (err) {
      setError(err.message)
      track('sign_in_failed', { status: err.status ?? 0 })
      setBusy(false)
    }
  }

  return (
    <main className="screen screen--login on-dark">
      <form className="screen__inner" onSubmit={submit} noValidate>
        <Logo variant="white" />

        <Hgroup title="Welcome" sub="Please enter your details below to sign in." />

        {notice ? (
          <div className="form-alert" style={{ marginTop: 0, marginBottom: 24 }}>
            <Alert kind="success" title={notice.title} text={notice.text} />
          </div>
        ) : null}

        <div className="fields">
          <Field
            id="login-mobile"
            label="Mobile Number"
            hint="e.g. 012 345 6789"
            type="tel"
            inputMode="tel"
            autoComplete="username"
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value)
              setError(null)
            }}
          />

          <Field
            id="login-password"
            label="Password"
            hint="Enter your password"
            password
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
          />
        </div>

        <div className="meta-row">
          <Check id="remember" checked={remember} onChange={setRemember}>
            Remember Me
          </Check>
          <Link className="link-sm" to="/forgot">
            Forgot Password?
          </Link>
        </div>

        {error || unavailable ? (
          <div className="form-alert">
            <Alert
              kind="error"
              title={unavailable ? 'Sign-in is unavailable' : "Couldn't sign you in"}
              text={
                unavailable
                  ? "Accounts aren't available right now. You can still use everything in the app."
                  : error
              }
            />
          </div>
        ) : null}

        <div className="actions">
          <Btn type="submit" label={busy ? 'Signing in' : 'Sign in'} loading={busy} disabled={unavailable} />

          <div className="or">
            <span>OR</span>
          </div>

          <Btn label="Create Account" variant="ghost" onClick={() => navigate('/register')} />
        </div>
      </form>
    </main>
  )
}
