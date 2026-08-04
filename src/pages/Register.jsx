import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { questionSlide } from '../lib/motion.js'
import { CloseIcon } from '../components/Icons.jsx'
import {
  ChoiceCard,
  Disclaimer,
  Field,
  FormError,
  PasswordField,
  PrimaryButton,
} from '../components/auth/formControls.jsx'
import { resendOtp, startRegistration, verifyOtp } from '../lib/authApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { track } from '../lib/analytics.js'

// Registration, as a linear flow of one decision per screen.
//
//   intro -> disclaimer -> creds     -> employer -> contact -> [otpChoose] -> otp -> done   (anonymous)
//   intro -> disclaimer -> identity  -> employer -> contact -> [otpChoose] -> otp -> done   (identified)
//
// Nothing is sent to the server until the contact step: the account is created
// and the first PIN issued in a single call, so an abandoned sign-up leaves no
// half-built row behind.

const MIN_PASSWORD = 8

const ANON_DISCLAIMER =
  "Your email and cell number are used only to confirm it's really you. Once you're verified we erase them, keeping only a one-way fingerprint so you can sign back in. Your activity is recorded against an anonymous account that we cannot trace back to you, and nothing identifying is ever shared with your employer."

const ID_DISCLAIMER =
  'Registering with your details lets us understand how the service is used so we can improve it. We will never share personally identifiable information with your employer — only de-identified, aggregate insights.'

function stepsFor(anonymous) {
  return ['intro', 'disclaimer', anonymous ? 'creds' : 'identity', 'employer', 'contact', 'otp']
}

export default function Register() {
  const navigate = useNavigate()
  const { adoptUser, unavailable } = useAuth()

  const [step, setStep] = useState('intro')
  const [anonymous, setAnonymous] = useState(true)
  const [form, setForm] = useState({
    username: '',
    password: '',
    firstName: '',
    lastName: '',
    idNumber: '',
    employer: '',
    employeeNo: '',
    email: '',
    phone: '',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Set once the server has created the pending account.
  const [pending, setPending] = useState(null) // { userId, channel, destination, devCode }
  const [code, setCode] = useState('')

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

  const progress = useMemo(() => {
    const order = stepsFor(anonymous)
    const i = order.indexOf(step)
    return step === 'done' ? 1 : i < 0 ? 0 : i / (order.length - 1)
  }, [step, anonymous])

  if (unavailable) {
    return (
      <Shell onClose={() => navigate('/explore')} progress={0}>
        <FormError>
          Accounts aren't available right now. You can still use everything in the app — browse
          Explore, follow a journey, or take an assessment.
        </FormError>
        <Link to="/explore" className="mt-4 block">
          <PrimaryButton type="button">Continue without an account</PrimaryButton>
        </Link>
      </Shell>
    )
  }

  // --- validation -------------------------------------------------------------

  function validate(which) {
    const e = {}
    if (which === 'creds') {
      if (form.username.trim().length < 3) e.username = 'At least 3 characters.'
      if (form.password.length < MIN_PASSWORD) e.password = `At least ${MIN_PASSWORD} characters.`
    }
    if (which === 'identity') {
      if (form.firstName.trim().length < 2) e.firstName = 'Enter your first name.'
      if (form.lastName.trim().length < 2) e.lastName = 'Enter your last name.'
      if (form.idNumber.replace(/\D/g, '').length !== 13) e.idNumber = 'Enter a valid 13-digit ID number.'
      if (form.password.length < MIN_PASSWORD) e.password = `At least ${MIN_PASSWORD} characters.`
    }
    if (which === 'employer') {
      if (form.employer.trim().length < 2) e.employer = "Enter your employer's name."
    }
    if (which === 'contact') {
      const hasEmail = form.email.trim() !== ''
      const hasPhone = form.phone.trim() !== ''
      if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        e.email = 'That email address looks wrong.'
      }
      if (hasPhone && form.phone.replace(/\D/g, '').length < 10) {
        e.phone = 'That cell number looks wrong.'
      }
      if (anonymous) {
        if (!hasEmail && !hasPhone) e.email = 'Give us at least one way to verify you.'
      } else {
        if (!hasEmail) e.email = 'Your email address is required.'
        if (!hasPhone) e.phone = 'Your cell number is required.'
      }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // --- server calls -----------------------------------------------------------

  async function submitRegistration(otpChannel) {
    setBusy(true)
    setFormError(null)
    try {
      const payload = {
        anonymous,
        password: form.password,
        employer: form.employer.trim(),
        employeeNo: form.employeeNo.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        otpChannel: otpChannel || null,
        ...(anonymous
          ? { username: form.username.trim() }
          : {
              firstName: form.firstName.trim(),
              lastName: form.lastName.trim(),
              idNumber: form.idNumber.replace(/\D/g, ''),
            }),
      }
      const result = await startRegistration(payload)
      setPending(result)
      setStep('otp')
      track('registration_otp_sent', { anonymous, channel: result.channel })
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitCode() {
    const clean = code.replace(/\D/g, '')
    if (clean.length !== 6) {
      setErrors({ code: 'Enter all 6 digits.' })
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const { user } = await verifyOtp(pending.userId, clean)
      adoptUser(user)
      setStep('done')
    } catch (err) {
      setErrors({ code: err.message })
    } finally {
      setBusy(false)
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
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // --- navigation -------------------------------------------------------------

  const goNext = (from) => {
    if (!validate(from)) return
    if (from === 'creds' || from === 'identity') return setStep('employer')
    if (from === 'employer') return setStep('contact')
    if (from === 'contact') {
      // Only ask which channel when they actually gave us both.
      const both = form.email.trim() && form.phone.trim()
      return both ? setStep('otpChoose') : submitRegistration(null)
    }
  }

  const back = () => {
    const order = ['intro', 'disclaimer', anonymous ? 'creds' : 'identity', 'employer', 'contact']
    const i = order.indexOf(step)
    if (step === 'otpChoose') return setStep('contact')
    if (i > 0) setStep(order[i - 1])
    else navigate('/explore')
  }

  // --- screens ----------------------------------------------------------------

  const content = () => {
    switch (step) {
      case 'intro':
        return (
          <Screen
            title="Create your account"
            subtitle="First — how would you like to register?"
          >
            <div className="space-y-3">
              <ChoiceCard
                title="Keep me anonymous"
                description="Verify by PIN, then we erase your contact details. Your activity can't be traced back to you."
                accent="#4CB03F"
                onClick={() => {
                  setAnonymous(true)
                  setStep('disclaimer')
                  track('registration_path_chosen', { anonymous: true })
                }}
              />
              <ChoiceCard
                title="Register with my details"
                description="A full account in your name, so your progress and results follow you."
                onClick={() => {
                  setAnonymous(false)
                  setStep('disclaimer')
                  track('registration_path_chosen', { anonymous: false })
                }}
              />
            </div>
            <p className="mt-5 text-center text-[13px] text-gray-500">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-brand">
                Sign in
              </Link>
            </p>
            <p className="mt-2 text-center text-[13px] text-gray-400">
              Or just{' '}
              <Link to="/explore" className="font-semibold text-gray-500 underline">
                keep browsing
              </Link>{' '}
              — an account is optional.
            </p>
          </Screen>
        )

      case 'disclaimer':
        return (
          <Screen
            title={anonymous ? 'What anonymous means' : 'How we use your data'}
            subtitle="Please read this before continuing."
          >
            <Disclaimer
              tone={anonymous ? 'privacy' : 'neutral'}
              title={anonymous ? 'Verified, then forgotten' : 'Never shared with your employer'}
            >
              {anonymous ? ANON_DISCLAIMER : ID_DISCLAIMER}
            </Disclaimer>
            <PrimaryButton
              className="mt-5"
              onClick={() => setStep(anonymous ? 'creds' : 'identity')}
            >
              I understand — continue
            </PrimaryButton>
          </Screen>
        )

      case 'creds':
        return (
          <Screen title="Choose your details" subtitle="This is how you'll sign back in.">
            <div className="space-y-4">
              <Field
                label="Username"
                value={form.username}
                onChange={set('username')}
                error={errors.username}
                hint="Pick something that isn't your real name — e.g. quiet-fox-42."
                autoComplete="username"
                autoCapitalize="none"
              />
              <PasswordField
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                hint={`At least ${MIN_PASSWORD} characters.`}
                autoComplete="new-password"
                placeholder="••••••••"
              />
              <PrimaryButton onClick={() => goNext('creds')}>Continue</PrimaryButton>
            </div>
          </Screen>
        )

      case 'identity':
        return (
          <Screen title="Tell us who you are" subtitle="So we can set up your account.">
            <div className="space-y-4">
              <div className="flex gap-3">
                <Field
                  label="First name"
                  className="flex-1"
                  value={form.firstName}
                  onChange={set('firstName')}
                  error={errors.firstName}
                  autoComplete="given-name"
                />
                <Field
                  label="Last name"
                  className="flex-1"
                  value={form.lastName}
                  onChange={set('lastName')}
                  error={errors.lastName}
                  autoComplete="family-name"
                />
              </div>
              <Field
                label="ID number"
                value={form.idNumber}
                onChange={set('idNumber')}
                error={errors.idNumber}
                hint="Stored only as a one-way fingerprint — we never keep the number itself."
                inputMode="numeric"
                placeholder="13-digit SA ID"
              />
              <PasswordField
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                hint={`At least ${MIN_PASSWORD} characters.`}
                autoComplete="new-password"
                placeholder="••••••••"
              />
              <PrimaryButton onClick={() => goNext('identity')}>Continue</PrimaryButton>
            </div>
          </Screen>
        )

      case 'employer':
        return (
          <Screen title="Where do you work?" subtitle="This links you to the right plan.">
            <div className="space-y-4">
              <Field
                label="Employer"
                value={form.employer}
                onChange={set('employer')}
                error={errors.employer}
                placeholder="e.g. Northgate Logistics"
              />
              <Field
                label="Employee / staff number"
                optional
                value={form.employeeNo}
                onChange={set('employeeNo')}
                placeholder="e.g. EMP-10293"
                hint={
                  anonymous
                    ? 'Used to match you to your plan. Nothing identifying is shared back to them.'
                    : 'Used to match you to your plan.'
                }
              />
              <PrimaryButton onClick={() => goNext('employer')}>Continue</PrimaryButton>
            </div>
          </Screen>
        )

      case 'contact':
        return (
          <Screen
            title="How should we verify you?"
            subtitle={
              anonymous
                ? "We'll send a one-time PIN, then erase whatever you give us."
                : 'We need both so we can verify your account.'
            }
          >
            <div className="space-y-4">
              <Field
                label="Email address"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                onChange={set('email')}
                error={errors.email}
                placeholder="you@example.co.za"
              />
              <Field
                label="Cell number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={set('phone')}
                error={errors.phone}
                placeholder="071 234 5678"
              />
              {anonymous ? (
                <p className="text-[12px] leading-relaxed text-gray-400">
                  Give us at least one. It's used to send your PIN and nothing else — once you're
                  verified it's erased.
                </p>
              ) : null}
              <FormError>{formError}</FormError>
              <PrimaryButton busy={busy} onClick={() => goNext('contact')}>
                Send my PIN
              </PrimaryButton>
            </div>
          </Screen>
        )

      case 'otpChoose':
        return (
          <Screen title="Where should we send it?" subtitle="You gave us both — your choice.">
            <div className="space-y-3">
              <ChoiceCard
                title="Email"
                description={form.email.trim()}
                onClick={() => submitRegistration('email')}
              />
              <ChoiceCard
                title="SMS"
                description={form.phone.trim()}
                accent="#4CB03F"
                onClick={() => submitRegistration('sms')}
              />
            </div>
            <FormError>{formError}</FormError>
          </Screen>
        )

      case 'otp':
        return (
          <Screen
            title="Enter your PIN"
            subtitle={`We sent a 6-digit PIN to ${pending?.destination ?? 'you'}.`}
          >
            <div className="space-y-4">
              <div>
                <input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                    setErrors({})
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="––––––"
                  aria-label="6-digit PIN"
                  className={[
                    'w-full rounded-btn border bg-white py-4 text-center text-[26px] font-bold',
                    'tracking-[0.4em] text-black outline-none focus:border-brand',
                    'placeholder:tracking-[0.3em] placeholder:text-gray-200',
                    errors.code ? 'border-red-500' : 'border-gray-200',
                  ].join(' ')}
                />
                {errors.code ? (
                  <p className="mt-1.5 text-[12px] text-red-600">{errors.code}</p>
                ) : null}
              </div>

              {pending?.delivered === false ? (
                <FormError>
                  We couldn't deliver the PIN. Check the address and try resending.
                </FormError>
              ) : null}
              <FormError>{formError}</FormError>

              <PrimaryButton busy={busy} onClick={submitCode}>
                Verify
              </PrimaryButton>

              <button
                type="button"
                onClick={resend}
                disabled={busy}
                className="min-h-[44px] w-full text-[13px] font-semibold text-brand disabled:opacity-40"
              >
                Resend PIN
              </button>

              {/* Demo mode (OTP_ECHO). Deliberately loud: this must never be
                  mistaken for part of the real product. */}
              {pending?.devCode ? (
                <div className="rounded-card border border-amber-300 bg-amber-50 p-4 text-center">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
                    Demo mode — no message was sent
                  </p>
                  <button
                    type="button"
                    onClick={() => setCode(pending.devCode)}
                    className="mt-2 font-mono text-[30px] font-bold tracking-[0.3em] text-black active:opacity-60"
                    title="Tap to fill it in"
                  >
                    {pending.devCode}
                  </button>
                  <p className="mt-1 text-[12px] text-amber-800">
                    Tap the code to fill it in. Turn this off with{' '}
                    <span className="font-mono">OTP_ECHO=false</span> before real users see it.
                  </p>
                </div>
              ) : null}
            </div>
          </Screen>
        )

      case 'done':
        return (
          <Screen
            title={anonymous ? "You're registered anonymously" : 'Your account is ready'}
            subtitle={
              anonymous
                ? 'Your contact details were used for verification and have now been erased.'
                : 'Welcome to AskNelson.'
            }
          >
            <div className="rounded-card bg-brand-green/5 p-5 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green/10">
                <span className="text-2xl" role="img" aria-label="celebrate">
                  🌿
                </span>
              </div>
              <p className="text-[14px] leading-relaxed text-gray-600">
                {anonymous
                  ? 'Sign in any time with your username and password.'
                  : 'Everything you do now follows you across devices.'}
              </p>
            </div>
            <PrimaryButton className="mt-5" onClick={() => navigate('/explore')}>
              Start exploring
            </PrimaryButton>
          </Screen>
        )

      default:
        return null
    }
  }

  return (
    <Shell onClose={() => navigate('/explore')} progress={progress} onBack={step === 'intro' || step === 'done' ? null : back}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} variants={questionSlide} initial="enter" animate="center" exit="exit">
          {content()}
        </motion.div>
      </AnimatePresence>
    </Shell>
  )
}

// --- layout -------------------------------------------------------------------

function Shell({ children, onClose, onBack, progress }) {
  return (
    <div className="page-enter min-h-screen bg-canvas">
      <header
        className={[
          'sticky top-0 z-30 bg-white/92 backdrop-blur-md',
          'pt-[calc(1rem+env(safe-area-inset-top,0px))]',
          '[box-shadow:0_1px_0_0_rgb(0_0_0/0.06)]',
        ].join(' ')}
      >
        <div className="mx-auto flex max-w-md items-center gap-2 px-3 pb-3">
          <button
            type="button"
            onClick={onBack || onClose}
            aria-label={onBack ? 'Back' : 'Close'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 active:bg-gray-100"
          >
            {onBack ? <span className="text-lg leading-none">‹</span> : <CloseIcon className="h-5 w-5" />}
          </button>
          <span className="text-[15px] font-bold text-black">AskNelson</span>
        </div>
        {/* Progress rail — a quiet sense of how much is left. */}
        <div className="h-0.5 w-full bg-gray-100">
          <div
            className="h-full bg-brand transition-[width] duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-5 pb-16 pt-6">{children}</main>
    </div>
  )
}

function Screen({ title, subtitle, children }) {
  return (
    <div>
      <h1 className="font-display text-[24px] font-semibold leading-tight text-black">{title}</h1>
      {subtitle ? (
        <p className="mt-1.5 text-[14px] leading-relaxed text-gray-500">{subtitle}</p>
      ) : null}
      <div className="mt-6">{children}</div>
    </div>
  )
}
