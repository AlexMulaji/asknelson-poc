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

function stepsFor(anonymous) {
  return ['createStep1', 'createStep2', 'verify', anonymous ? 'creds' : 'identity', 'employer', 'contact', 'otp']
}

export default function Register() {
  const navigate = useNavigate()
  const { adoptUser, unavailable } = useAuth()

  const [verifyState, setVerifyState] = useState('idle') //idle | veryfying
  const [step, setStep] = useState('createStep1')
  const [anonymous, setAnonymous] = useState(true)
  const [otp, setOtp] = useState("");
  const [form, setForm] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    idNumber: '',
    employer: '',
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

  // if (unavailable) {
  //   return (
  //     <Shell onClose={() => navigate('/explore')} progress={0}>
  //       <FormError>
  //         Accounts aren't available right now. You can still use everything in the app — browse
  //         Explore, follow a journey, or take an assessment.
  //       </FormError>
  //       <Link to="/explore" className="mt-4 block">
  //         <PrimaryButton type="button">Continue without an account</PrimaryButton>
  //       </Link>
  //     </Shell>
  //   )
  // }

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
    if (from === 'createStep1') return setStep('createStep2')
    if (from === 'createStep2') return setStep('verify')
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

/* --- 2. Create Account · step 1 (details) ----------------------------- */
// const createStep1 = () => ({
//   cls:"screen--create",
//   html:`
//     ${Logo()}
//     ${Hgroup("Create Account","Please enter your details to create an account.")}
//     ${Stepper(1)}
//     <div class="fields">
//       ${Field({id:"ca-mobile",label:"Mobile Number",hint:"e.g. 012 345 6789",type:"tel",inputmode:"tel",autocomplete:"tel"})}
//       ${Field({id:"ca-email",label:"Email Address",optional:true,hint:"name@example.com",type:"email",autocomplete:"email"})}
//       ${Field({id:"ca-id",label:"ID Number",hint:"name@example.com",inputmode:"numeric"})}
//       ${Field({id:"ca-company",label:"Company Name",hint:"Enter your company name",autocomplete:"organization"})}
//     </div>
//     <div class="actions">
//       ${Btn("Next",{go:"createStep2"})}
//       ${Footnote("Already have an account?","Sign In","login")}
//     </div>`
// });

// /* --- 3. Create Account · step 2 (password) ---------------------------- */
// const createStep2 = () => ({
//   cls:"screen--create",
//   html:`
//     ${Logo()}
//     ${Hgroup("Create Account","Please enter your details to create an account.")}
//     ${Stepper(2)}
//     <div class="fields">
//       ${Field({id:"ca-pw",label:"Password",hint:"Enter your password",type:"password",password:true,autocomplete:"new-password"})}
//       ${Field({id:"ca-pw2",label:"Password Confirmation",hint:"Confirm password",type:"password",password:true,autocomplete:"new-password"})}
//     </div>
//     <div class="actions">
//       ${Btn("Create Account",{go:"verify"})}
//       ${Footnote("Already have an account?","Sign In","login")}
//     </div>`
// });

// /* --- 4/5. Verify Account (empty + verifying) -------------------------- */
// const verifyScreen = (loading) => ({
//   cls:"screen--verify",
//   html:`
//     ${Logo()}
//     ${Hgroup("Verify Account","Enter the 6-digit code that has been sent to <strong>+27 123 4567</strong>.")}
//     <div class="otp-group">
//       ${Otp(loading ? "123456" : "")}
//       <p class="footnote">Didn’t receive a code?<a href="#" data-act="resend">Resend code</a></p>
//     </div>
//     <div class="actions verify-actions">
//       ${loading ? Btn("Verifying",{loading:true}) : Btn("Verify",{act:"verify"})}
//     </div>`
// });
// const verify = () => verifyScreen(false);
// const verifying = () => verifyScreen(true);



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
                value = {form.email}
                onChange={set('email')}
              />

              <Field
                id="ca-id"
                label="ID Number"
                hint="name@example.com"
                inputMode="numeric"
                value = {form.idNumber}
                onChange={set('idNumber')}
              />

              <Field
                id="ca-company"
                label="Company Name"
                hint="Enter your company name"
                autoComplete="organization"
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
          // <Screen
          //   title="Create your account"
          //   subtitle="First — how would you like to register?"
          // >
          //   <div className="space-y-3">
          //     <ChoiceCard
          //       title="Keep me anonymous"
          //       description="Verify by PIN, then we erase your contact details. Your activity can't be traced back to you."
          //       accent="#4CB03F"
          //       onClick={() => {
          //         setAnonymous(true)
          //         setStep('disclaimer')
          //         track('registration_path_chosen', { anonymous: true })
          //       }}
          //     />
          //     <ChoiceCard
          //       title="Register with my details"
          //       description="A full account in your name, so your progress and results follow you."
          //       onClick={() => {
          //         setAnonymous(false)
          //         setStep('disclaimer')
          //         track('registration_path_chosen', { anonymous: false })
          //       }}
          //     />
          //   </div>
          //   <p className="mt-5 text-center text-[13px] text-gray-500">
          //     Already have an account?{' '}
          //     <Link to="/login" className="font-semibold text-brand">
          //       Sign in
          //     </Link>
          //   </p>
          //   <p className="mt-2 text-center text-[13px] text-gray-400">
          //     Or just{' '}
          //     <Link to="/explore" className="font-semibold text-gray-500 underline">
          //       keep browsing
          //     </Link>{' '}
          //     — an account is optional.
          //   </p>
          // </Screen>
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
                digits = {otp}
                onChange={setOtp}
              />

              <p className="footnote">
                Didn’t receive a code?
                <a
                  href="#"
                >
                  Resend code
                </a>
              </p>
            </div>

            <div className="actions verify-actions">
              {verifyState === "idle" ?(
                <Btn
                label="Verify"
                act="verify"
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
        

      // case 'disclaimer':
      //   return (
      //     <Screen
      //       title={anonymous ? 'What anonymous means' : 'How we use your data'}
      //       subtitle="Please read this before continuing."
      //     >
      //       <Disclaimer
      //         tone={anonymous ? 'privacy' : 'neutral'}
      //         title={anonymous ? 'Verified, then forgotten' : 'Never shared with your employer'}
      //       >
      //         {anonymous ? ANON_DISCLAIMER : ID_DISCLAIMER}
      //       </Disclaimer>
      //       <PrimaryButton
      //         className="mt-5"
      //         onClick={() => setStep(anonymous ? 'creds' : 'identity')}
      //       >
      //         I understand — continue
      //       </PrimaryButton>
      //     </Screen>
      //   )

      // case 'creds':
      //   return (
      //     <Screen title="Choose your details" subtitle="This is how you'll sign back in.">
      //       <div className="space-y-4">
      //         <Field
      //           label="Username"
      //           value={form.username}
      //           onChange={set('username')}
      //           error={errors.username}
      //           hint="Pick something that isn't your real name — e.g. quiet-fox-42."
      //           autoComplete="username"
      //           autoCapitalize="none"
      //         />
      //         <PasswordField
      //           value={form.password}
      //           onChange={set('password')}
      //           error={errors.password}
      //           hint={`At least ${MIN_PASSWORD} characters.`}
      //           autoComplete="new-password"
      //           placeholder="••••••••"
      //         />
      //         <PrimaryButton onClick={() => goNext('creds')}>Continue</PrimaryButton>
      //       </div>
      //     </Screen>
      //   )

      // case 'identity':
      //   return (
      //     <Screen title="Tell us who you are" subtitle="So we can set up your account.">
      //       <div className="space-y-4">
      //         <div className="flex gap-3">
      //           <Field
      //             label="First name"
      //             className="flex-1"
      //             value={form.firstName}
      //             onChange={set('firstName')}
      //             error={errors.firstName}
      //             autoComplete="given-name"
      //           />
      //           <Field
      //             label="Last name"
      //             className="flex-1"
      //             value={form.lastName}
      //             onChange={set('lastName')}
      //             error={errors.lastName}
      //             autoComplete="family-name"
      //           />
      //         </div>
      //         <Field
      //           label="ID number"
      //           value={form.idNumber}
      //           onChange={set('idNumber')}
      //           error={errors.idNumber}
      //           hint="Stored only as a one-way fingerprint — we never keep the number itself."
      //           inputMode="numeric"
      //           placeholder="13-digit SA ID"
      //         />
      //         <PasswordField
      //           value={form.password}
      //           onChange={set('password')}
      //           error={errors.password}
      //           hint={`At least ${MIN_PASSWORD} characters.`}
      //           autoComplete="new-password"
      //           placeholder="••••••••"
      //         />
      //         <PrimaryButton onClick={() => goNext('identity')}>Continue</PrimaryButton>
      //       </div>
      //     </Screen>
      //   )

      // case 'employer':
      //   return (
      //     <Screen title="Where do you work?" subtitle="This links you to the right plan.">
      //       <div className="space-y-4">
      //         <Field
      //           label="Employer"
      //           value={form.employer}
      //           onChange={set('employer')}
      //           error={errors.employer}
      //           placeholder="e.g. Northgate Logistics"
      //         />
      //         <Field
      //           label="Employee / staff number"
      //           optional
      //           value={form.employeeNo}
      //           onChange={set('employeeNo')}
      //           placeholder="e.g. EMP-10293"
      //           hint={
      //             anonymous
      //               ? 'Used to match you to your plan. Nothing identifying is shared back to them.'
      //               : 'Used to match you to your plan.'
      //           }
      //         />
      //         <PrimaryButton onClick={() => goNext('employer')}>Continue</PrimaryButton>
      //       </div>
      //     </Screen>
      //   )

      // case 'contact':
      //   return (
      //     <Screen
      //       title="How should we verify you?"
      //       subtitle={
      //         anonymous
      //           ? "We'll send a one-time PIN, then erase whatever you give us."
      //           : 'We need both so we can verify your account.'
      //       }
      //     >
      //       <div className="space-y-4">
      //         <Field
      //           label="Email address"
      //           type="email"
      //           inputMode="email"
      //           autoComplete="email"
      //           value={form.email}
      //           onChange={set('email')}
      //           error={errors.email}
      //           placeholder="you@example.co.za"
      //         />
      //         <Field
      //           label="Cell number"
      //           type="tel"
      //           inputMode="tel"
      //           autoComplete="tel"
      //           value={form.phone}
      //           onChange={set('phone')}
      //           error={errors.phone}
      //           placeholder="071 234 5678"
      //         />
      //         {anonymous ? (
      //           <p className="text-[12px] leading-relaxed text-gray-400">
      //             Give us at least one. It's used to send your PIN and nothing else — once you're
      //             verified it's erased.
      //           </p>
      //         ) : null}
      //         <FormError>{formError}</FormError>
      //         <PrimaryButton busy={busy} onClick={() => goNext('contact')}>
      //           Send my PIN
      //         </PrimaryButton>
      //       </div>
      //     </Screen>
      //   )

      // case 'otpChoose':
      //   return (
      //     <Screen title="Where should we send it?" subtitle="You gave us both — your choice.">
      //       <div className="space-y-3">
      //         <ChoiceCard
      //           title="Email"
      //           description={form.email.trim()}
      //           onClick={() => submitRegistration('email')}
      //         />
      //         <ChoiceCard
      //           title="SMS"
      //           description={form.phone.trim()}
      //           accent="#4CB03F"
      //           onClick={() => submitRegistration('sms')}
      //         />
      //       </div>
      //       <FormError>{formError}</FormError>
      //     </Screen>
      //   )

      // case 'otp':
      //   return (
      //     <Screen
      //       title="Enter your PIN"
      //       subtitle={`We sent a 6-digit PIN to ${pending?.destination ?? 'you'}.`}
      //     >
      //       <div className="space-y-4">
      //         <div>
      //           <input
      //             value={code}
      //             onChange={(e) => {
      //               setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
      //               setErrors({})
      //             }}
      //             inputMode="numeric"
      //             autoComplete="one-time-code"
      //             maxLength={6}
      //             placeholder="––––––"
      //             aria-label="6-digit PIN"
      //             className={[
      //               'w-full rounded-btn border bg-white py-4 text-center text-[26px] font-bold',
      //               'tracking-[0.4em] text-black outline-none focus:border-brand',
      //               'placeholder:tracking-[0.3em] placeholder:text-gray-200',
      //               errors.code ? 'border-red-500' : 'border-gray-200',
      //             ].join(' ')}
      //           />
      //           {errors.code ? (
      //             <p className="mt-1.5 text-[12px] text-red-600">{errors.code}</p>
      //           ) : null}
      //         </div>

      //         {pending?.delivered === false ? (
      //           <FormError>
      //             We couldn't deliver the PIN. Check the address and try resending.
      //           </FormError>
      //         ) : null}
      //         <FormError>{formError}</FormError>

      //         <PrimaryButton busy={busy} onClick={submitCode}>
      //           Verify
      //         </PrimaryButton>

      //         <button
      //           type="button"
      //           onClick={resend}
      //           disabled={busy}
      //           className="min-h-[44px] w-full text-[13px] font-semibold text-brand disabled:opacity-40"
      //         >
      //           Resend PIN
      //         </button>

      //         {/* Demo mode (OTP_ECHO). Deliberately loud: this must never be
      //             mistaken for part of the real product. */}
      //         {pending?.devCode ? (
      //           <div className="rounded-card border border-amber-300 bg-amber-50 p-4 text-center">
      //             <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">
      //               Demo mode — no message was sent
      //             </p>
      //             <button
      //               type="button"
      //               onClick={() => setCode(pending.devCode)}
      //               className="mt-2 font-mono text-[30px] font-bold tracking-[0.3em] text-black active:opacity-60"
      //               title="Tap to fill it in"
      //             >
      //               {pending.devCode}
      //             </button>
      //             <p className="mt-1 text-[12px] text-amber-800">
      //               Tap the code to fill it in. Turn this off with{' '}
      //               <span className="font-mono">OTP_ECHO=false</span> before real users see it.
      //             </p>
      //           </div>
      //         ) : null}
      //       </div>
      //     </Screen>
      //   )

      // case 'done':
      //   return (
      //     <Screen
      //       title={anonymous ? "You're registered anonymously" : 'Your account is ready'}
      //       subtitle={
      //         anonymous
      //           ? 'Your contact details were used for verification and have now been erased.'
      //           : 'Welcome to AskNelson.'
      //       }
      //     >
      //       <div className="rounded-card bg-brand-green/5 p-5 text-center">
      //         <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green/10">
      //           <span className="text-2xl" role="img" aria-label="celebrate">
      //             🌿
      //           </span>
      //         </div>
      //         <p className="text-[14px] leading-relaxed text-gray-600">
      //           {anonymous
      //             ? 'Sign in any time with your username and password.'
      //             : 'Everything you do now follows you across devices.'}
      //         </p>
      //       </div>
      //       <PrimaryButton className="mt-5" onClick={() => navigate('/explore')}>
      //         Start exploring
      //       </PrimaryButton>
      //     </Screen>
      //   )

      default:
        return null
    }
  

  

  // return (
  //   <Shell onClose={() => navigate('/explore')} progress={progress} onBack={step === 'intro' || step === 'done' ? null : back}>
  //     <AnimatePresence mode="wait" initial={false}>
  //       <motion.div key={step} variants={questionSlide} initial="enter" animate="center" exit="exit">
  //         {content()}
  //       </motion.div>
  //     </AnimatePresence>
  //   </Shell>
  // )
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
