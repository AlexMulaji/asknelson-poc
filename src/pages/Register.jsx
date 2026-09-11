import { React, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { questionSlide } from '../lib/motion.js'
import { CloseIcon } from '../components/Icons.jsx'
import {
  ChoiceCard,
  Disclaimer,
  
  FormError,
  PasswordField,
  PrimaryButton,
} from '../components/auth/formControls.jsx'
import { resendOtp, startRegistration, verifyOtp } from '../lib/authApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { track } from '../lib/analytics.js'
import { 
  Logo, 
  Hgroup, 
  Field, 
  Btn,
  Footnote,
  Stepper,
  Otp
} from '../components/auth/authPrims.jsx'

import authstyle from '../assets/auth/auth_style.css'

//Need to clean this up on next commit
const ICON = {
  chevron:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 17L15 12L10 7" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  hidden:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10.73 5.073C11.1516 5.024 11.5756 5 12 5c4.664 0 8.4 2.903 10 7-.387.997-.911 1.935-1.555 2.788M6.52 6.519C4.48 7.764 2.9 9.693 2 12c1.6 4.097 5.336 7 10 7 1.932.01 3.829-.516 5.48-1.52M9.88 9.88a3 3 0 104.24 4.24M4 4l16 16" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  eye:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14.1213 14.1213A3 3 0 109.8787 9.8787a3 3 0 004.2426 4.2426Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 12c1.6-4.097 5.336-7 10-7s8.4 2.903 10 7c-1.6 4.097-5.336 7-10 7s-8.4-2.903-10-7Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  tick:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.125 13.125L9.375 18.375L19.875 7.125" stroke="#637885" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  call:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15.5 21a1.5 1.5 0 001.5-1.5v-3.2a1.5 1.5 0 00-1.18-1.47l-2.3-.5a1.5 1.5 0 00-1.46.5l-.9 1.06a13.6 13.6 0 01-4.05-4.05l1.06-.9a1.5 1.5 0 00.5-1.46l-.5-2.3A1.5 1.5 0 007.7 5H4.5A1.5 1.5 0 003 6.5C3 14.5 8.5 21 15.5 21Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  email:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 7.2l8.42 5.62a2 2 0 002.16 0L21.5 7.2" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  info:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 11v5M12 21a9 9 0 110-18 9 9 0 010 18ZM12.05 8v.1h-.1V8h.1Z" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  restart:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.252 4v5H9M5.07 8a8 8 0 1114.855 5.081A8 8 0 014.252 14" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>,
  loader:<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21.25a9.25 9.25 0 100-18.5A9.25 9.25 0 002.75 12" stroke="#637885" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
};

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

function stepsFor() {
  return ['createStep1', 'createStep2', 'verify']
}

export default function Register() {
  const navigate = useNavigate()
  const { adoptUser, unavailable } = useAuth()

  const [step, setStep] = useState('createStep1')
  const [anonymous, setAnonymous] = useState(true)
  const [form, setForm] = useState({
    phone: '',
    email: '',
    idNumber: '',
    employer: '',
    password: '',
    confirmPassword: '',
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
    const order = stepsFor()
    const i = order.indexOf(step)
    return step === 'done' ? 1 : i < 0 ? 0 : i / (order.length - 1)
  }, [step])


  // --- validation -------------------------------------------------------------

  function validate(which) {
    const e = {}
    if (which === 'createStep1') {
      const hasEmail = form.email.trim() !== ''
      const hasPhone = form.phone.trim() !== ''
      if (hasEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        e.email = 'That email address looks wrong.'
      }
      if (hasPhone && form.phone.replace(/\D/g, '').length < 10) {
        e.phone = 'That cell number looks wrong.'
      }
      if (form.idNumber.replace(/\D/g, '').length !== 13) e.idNumber = 'Enter a valid 13-digit ID number.'
      if (form.employer.trim().length < 2) e.employer = "Enter your employer's name."
    }
    if (which === 'createStep2') {
      if (form.password.length < MIN_PASSWORD || form.password !== form.confirmPassword){ 
        e.password = `At least ${MIN_PASSWORD} characters.`
      }
    }
    
    setErrors(e)
    return Object.keys(e).length === 0
  }

  // --- server calls -----------------------------------------------------------

  async function submitRegistration() {
    setBusy(true)
    setFormError(null)
    try {
      const payload = {
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        idNumber: form.idNumber.replace(/\D/g, ''),
        employer: form.employer.trim(),
        password: form.password,
        otpChannel: 'sms',
      }
      const result = await startRegistration(payload)
      setPending(result)
      setStep('verify')
      track('registration_otp_sent', { anonymous, channel: result.channel })
    } catch (err) {
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitCode() {
    console.log('submitCode', code)
    const clean = code.replace(/\D/g, '')
    if (clean.length !== 6) {
      console.log('submitCode: invalid code length', clean.length)
      setErrors({ code: 'Enter all 6 digits.' })
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const { user } = await verifyOtp(pending.userId, clean)
      adoptUser(user)
      setStep('done')
      navigate('/login')
    } catch (err) {
      setErrors({ code: err.message })
      setCode('')
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
    if (from === 'createStep1') return setStep('createStep2')
    if (from === 'createStep2') {
      submitRegistration()
      return setStep('verify')
    }
    if (from === 'verify') {
      submitCode()
    }
  }

  const back = () => {
    const order = ['intro', 'disclaimer', anonymous ? 'creds' : 'identity', 'employer', 'contact']
    const i = order.indexOf(step)
    if (step === 'otpChoose') return setStep('contact')
    if (i > 0) setStep(order[i - 1])
    else navigate('/explore')
  }

    switch (step) {
      case 'createStep1':
        return (
          <main className="screen screen--create">
          <div className="screen__inner">
            <Logo />

            <Hgroup
              title="Create Account"
              sub="Please enter your details to create an account."
            />

            <Stepper step={1} />

            <div className="fields">
              <Field
                id="ca-mobile"
                label="Mobile Number"
                hint="e.g. 012 345 6789"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                error = {errors.phone}
                value = {form.phone}
                onChange={set('phone')}
              />

              <Field
                id="ca-email"
                label="Email Address"
                optional
                hint="name@example.com"
                type="email"
                autoComplete="email"
                error = {errors.email}
                value = {form.email}
                onChange={set('email')}
              />

              <Field
                id="ca-id"
                label="ID Number"
                hint="name@example.com"
                inputMode="numeric"
                error = {errors.idNumber}
                value = {form.idNumber}
                onChange={set('idNumber')}
              />

              <Field
                id="ca-company"
                label="Company Name"
                hint="Enter your company name"
                autoComplete="organization"
                error = {errors.employer}
                value = {form.employer}
                onChange={set('employer')}
              />
            </div>

            <div className="actions">
              <Btn label="Next" go="createStep2" onClick={() => goNext(step)} />

              <Footnote
                text="Already have an account?"
                linkLabel="Sign In"
                go="login"
                onClick={() => navigate('/login')}
              />
            </div>
          </div>
          </main>
         
        )

      case 'createStep2':
        return (
          <main className="screen screen--create">
          <div className="screen__inner">
            <Logo />

            <Hgroup
              title="Create Account"
              sub="Please enter your details to create an account."
            />

            <Stepper step={2} />

            <div className="fields">
              <Field
                id="ca-pw"
                label="Password"
                hint="Enter your password"
                type="password"
                password
                autoComplete="new-password"
                value = {form.password}
                onChange={set('password')}
              />

              <Field
                id="ca-pw2"
                label="Password Confirmation"
                hint="Confirm password"
                type="password"
                password
                autoComplete="new-password"
                error = {errors.password}
                value = {form.confirmPassword}
                onChange={set('confirmPassword')}
              />
            </div>

            <div className="actions">
              <Btn
                label="Create Account"
                go="verify"
                onClick={() => goNext(step)}
              />

              <Footnote
                text="Already have an account?"
                linkLabel="Sign In"
                go="login"
                onClick={() => navigate('/login')}
              />
            </div>
          </div>
          </main>
        )

      case 'verify':
        return (
          <main className="screen screen--verify">
          <div className="screen__inner">
            <Logo />

            <Hgroup
              title="Verify Account"
              sub={
                <>
                  Enter the 6-digit code that has been sent to{" "}
                  <strong>+27 123 4567</strong>.
                </>
              }
            />

            <div className="otp-group">
              <Otp 
                digits = {code}
                onChange={setCode}
              />

              <p className="footnote">
                Didn’t receive a code?
                <a
                  href="#"
                  onClick={() => {
                    resend()
                    setBusy(false)
                    setOtp('')
                  }}
                >
                  Resend code
                </a>
              </p>
            </div>

            <div className="actions verify-actions">
              {!busy ?(
                <Btn
                label="Verify"
                act="verify"
                onClick={() => {
                  goNext(step)}}
              />
              ) : (
                <Btn
                label="Verifying"
                loading = {true}
              />
              )
              }
            </div>
          </div>
          </main>
        );

      default:
        return null
    }
}