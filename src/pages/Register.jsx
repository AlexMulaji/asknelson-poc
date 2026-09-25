import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { resendOtp, startRegistration, verifyOtp } from '../lib/authApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { track } from '../lib/analytics.js'
import { MIN_PASSWORD, isEmail, isMobile } from '../lib/validation.js'
import {
  Alert,
  BackBtn,
  Btn,
  Check,
  DemoNote,
  Field,
  Footnote,
  Hgroup,
  Logo,
  Otp,
  Stepper,
} from '../components/auth/authPrims.jsx'
import '../assets/auth/auth_style.css'

// Create Account — the Figma flow:
//
//   details (mobile, email?, ID number, company)
//     -> password (+ privacy consent)
//     -> verify (6-digit code sent to the mobile number)
//
// Nothing reaches the server until the password step: the account is created
// and the first code sent in one call, so an abandoned sign-up leaves no
// half-built row (and a pending one is deleted after 24 hours).
//
// Two small additions to the design: a back button on the password and verify
// steps (so a mistyped number can be fixed), and the consent checkbox — POPIA
// needs explicit consent before assessment results, which are health
// information, can be stored.

const STEP_EVENTS = { details: 'details', password: 'password' }

export default function Register() {
  const navigate = useNavigate()
  const { adoptUser, unavailable } = useAuth()

  const [step, setStep] = useState('details') // details | password | verify
  const [form, setForm] = useState({
    phone: '',
    email: '',
    idNumber: '',
    company: '',
    password: '',
    confirmPassword: '',
  })
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Set once the server has created the pending account.
  const [pending, setPending] = useState(null) // { userId, channel, destination, delivered, devCode }
  const [code, setCode] = useState('')
  const [resent, setResent] = useState(false)
  const verifyingRef = useRef(false)
  const startedRef = useRef(false)

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [step])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    track('registration_started', {})
  }, [])

  const set = (key) => (e) => {
    const value = e?.target ? e.target.value : e
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((prev) => (prev[key] ? { ...prev, [key]: null } : prev))
    setFormError(null)
  }

  // --- validation -------------------------------------------------------------

  function validate(which) {
    const e = {}
    if (which === 'details') {
      if (!isMobile(form.phone)) e.phone = 'Enter your 10-digit mobile number.'
      if (form.email.trim() && !isEmail(form.email)) e.email = 'That email address looks wrong.'
      // Any 13 digits for now. The server can insist on a real SA ID
      // (AUTH_STRICT_SA_ID=true); its message then shows on this screen.
      const idDigits = form.idNumber.replace(/\D/g, '')
      if (idDigits.length !== 13) {
        e.idNumber = `Your ID number should be 13 digits (you've entered ${idDigits.length}).`
      }
      if (form.company.trim().length < 2) e.company = 'Enter your company name.'
    }
    if (which === 'password') {
      if (form.password.length < MIN_PASSWORD) e.password = `Use at least ${MIN_PASSWORD} characters.`
      if (form.confirmPassword !== form.password) e.confirmPassword = "The passwords don't match."
      if (!consent) e.consent = 'Please accept the privacy notice to continue.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function next(which) {
    if (!validate(which)) return
    track('registration_step_completed', { step: STEP_EVENTS[which] })
    if (which === 'details') setStep('password')
    else createAccount()
  }

  // --- server calls -----------------------------------------------------------

  async function createAccount() {
    setBusy(true)
    setFormError(null)
    try {
      const result = await startRegistration({
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        idNumber: form.idNumber.replace(/\D/g, ''),
        company: form.company.trim(),
        password: form.password,
        consent: true,
      })
      setPending(result)
      setCode('')
      setStep('verify')
      track('registration_otp_sent', { channel: result.channel })
    } catch (err) {
      setFormError(err.message)
      // An existing account or a rejected ID number is fixed on the details screen.
      if (err.status === 409 || /ID number/i.test(err.message)) setStep('details')
    } finally {
      setBusy(false)
    }
  }

  async function verify(value = code) {
    const clean = value.replace(/\D/g, '')
    if (clean.length !== 6) {
      setErrors({ code: 'Enter all 6 digits.' })
      return
    }
    // The last digit auto-submits and the button can too; send once.
    if (verifyingRef.current) return
    verifyingRef.current = true
    setBusy(true)
    setErrors({})
    try {
      const { user } = await verifyOtp(pending.userId, clean)
      await adoptUser(user)
      navigate('/home', { replace: true })
    } catch (err) {
      setErrors({ code: err.message })
      setCode('')
      track('registration_verification_failed', {})
      setBusy(false)
    } finally {
      verifyingRef.current = false
    }
  }

  async function resend() {
    setBusy(true)
    setFormError(null)
    try {
      const result = await resendOtp(pending.userId, pending.channel)
      setPending((p) => ({ ...p, ...result }))
      setCode('')
      setErrors({})
      setResent(true)
      track('registration_otp_resent', { channel: result.channel })
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // --- screens ----------------------------------------------------------------

  const signInFoot = (
    <Footnote text="Already have an account?" linkLabel="Sign In" href="/login" onClick={() => navigate('/login')} />
  )

  const errorAlert =
    formError || unavailable ? (
      <div className="form-alert">
        <Alert
          kind="error"
          title={unavailable ? 'Sign-up is unavailable' : "We couldn't create your account"}
          text={
            unavailable
              ? "Accounts aren't available right now. You can still use everything in the app."
              : formError
          }
        />
      </div>
    ) : null

  if (step === 'details') {
    return (
      <main className="screen screen--create">
        <form className="screen__inner" onSubmit={(e) => (e.preventDefault(), next('details'))} noValidate>
          <Logo />
          <Hgroup title="Create Account" sub="Please enter your details to create an account." />
          <Stepper step={1} />

          <div className="fields">
            <Field
              id="ca-mobile"
              label="Mobile Number"
              hint="e.g. 012 345 6789"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={set('phone')}
              error={errors.phone}
            />
            <Field
              id="ca-email"
              label="Email Address"
              optional
              hint="name@example.com"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
              error={errors.email}
            />
            <Field
              id="ca-id"
              label="ID Number"
              hint="13-digit SA ID number"
              inputMode="numeric"
              autoComplete="off"
              maxLength={16}
              value={form.idNumber}
              onChange={set('idNumber')}
              error={errors.idNumber}
            />
            <Field
              id="ca-company"
              label="Company Name"
              hint="Enter your company name"
              autoComplete="organization"
              value={form.company}
              onChange={set('company')}
              error={errors.company}
            />
          </div>

          {errorAlert}

          <div className="actions">
            <Btn type="submit" label="Next" disabled={unavailable} />
            {signInFoot}
          </div>
        </form>
      </main>
    )
  }

  if (step === 'password') {
    return (
      <main className="screen screen--create">
        <BackBtn onClick={() => setStep('details')} />
        <form className="screen__inner" onSubmit={(e) => (e.preventDefault(), next('password'))} noValidate>
          <Logo />
          <Hgroup title="Create Account" sub="Please enter your details to create an account." />
          <Stepper step={2} />

          <div className="fields">
            <Field
              id="ca-pw"
              label="Password"
              hint="Enter your password"
              password
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              error={errors.password}
            />
            <Field
              id="ca-pw2"
              label="Password Confirmation"
              hint="Confirm password"
              password
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
              error={errors.confirmPassword}
            />
          </div>

          <Check
            id="ca-consent"
            className="consent"
            checked={consent}
            onChange={(checked) => {
              setConsent(checked)
              setErrors((prev) => ({ ...prev, consent: null }))
            }}
          >
            We use cookies for this app {' '}
            <a href="/Kaelo_Cookie_Policy.pdf">
            cookie policy
            </a>
            . Your data is anonymous and only ever used according to our {''}
            <a href="/Kaelo-Privacy-Policy_V2.pdf">
            privacy notice
            </a>.
          </Check>
          {errors.consent ? <p className="field__error">{errors.consent}</p> : null}

          {errorAlert}

          <div className="actions">
            <Btn type="submit" label={busy ? 'Creating Account' : 'Create Account'} loading={busy} />
            {signInFoot}
          </div>
        </form>
      </main>
    )
  }

  // verify
  return (
    <main className="screen screen--verify">
      <BackBtn onClick={() => setStep('details')} />
      <form className="screen__inner" onSubmit={(e) => (e.preventDefault(), verify())} noValidate>
        <Logo />
        <Hgroup
          title="Verify Account"
          sub={
            <>
              Enter the 6-digit code that has been sent to <strong>{pending?.destination}</strong>.
            </>
          }
        />

        <div className="otp-group">
          <Otp digits={code} onChange={setCode} onComplete={verify} disabled={busy} error={Boolean(errors.code)} />

          <p className="footnote">
            Didn’t receive a code?
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                if (!busy) resend()
              }}
            >
              Resend code
            </a>
          </p>
        </div>

        {errors.code ? (
          <div className="form-alert">
            <Alert kind="error" title="That code didn't work" text={errors.code} />
          </div>
        ) : pending?.delivered === false ? (
          <div className="form-alert">
            <Alert
              kind="error"
              title="We couldn't send the code"
              text="Check your mobile number, or tap Resend code in a moment."
            />
          </div>
        ) : resent ? (
          <div className="form-alert">
            <Alert kind="success" title="New code sent" text={`We sent a new code to ${pending?.destination}.`} />
          </div>
        ) : null}
        {errorAlert}

        {pending?.devCode ? (
          <DemoNote>
            Your code is{' '}
            <button type="button" onClick={() => setCode(pending.devCode)}>
              {pending.devCode}
            </button>
            . Turn this off with OTP_ECHO=false before real users arrive.
          </DemoNote>
        ) : null}

        <div className="actions verify-actions">
          <Btn type="submit" label={busy ? 'Verifying' : 'Verify'} loading={busy} />
        </div>
      </form>
    </main>
  )
}
