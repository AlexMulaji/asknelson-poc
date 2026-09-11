import { React, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  
  FormError,
  PasswordField,
  PrimaryButton,
} from '../components/auth/formControls.jsx'
import { useAuth } from '../hooks/useAuth.jsx'
import logoUrl from '../assets/logo-asknelson.png'

import { 
  Logo, 
  Hgroup, 
  Field, 
  Btn
} from '../components/auth/authPrims.jsx'
// import { ICON } from '../components/Icons.jsx'

import '../assets/auth/auth_style.css'

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

  const submit = async () => {
    if (!identifier.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      await signIn(identifier.trim(), password)
      navigate('/home')
    } catch (err) {
      setError(err.message)
      setPassword('')
      setIdentifier('')
    } finally {
      setBusy(false)
      
    }
  }

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


  return (
    <main className="screen screen--login on-dark">
    <div className="screen__inner">
      <Logo variant="white" />

      <Hgroup
        title="Welcome"
        sub="Please enter your details below to sign in."
      />

      <div className="fields">
        <Field
          id="login-mobile"
          label="Mobile Number"
          hint="e.g. 012 345 6789"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
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
          type="password"
          password = {true}
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
        />
      </div>

      <div className="meta-row">
        <label className="check">
          <input type="checkbox" id="remember" checked={remember}
                onChange={(e) => setRemember(e.target.checked)} />

          <span
            className="check__box">{ICON.tick }</span>
            
          

          <span className="check__label">Remember Me</span>
        </label>

        <a
          className="link-sm"
          href="#"
          data-go="forgotOptionsCell"
          onClick={() => navigate('/forgot')}
        >
          Forgot Password?
        </a>
      </div>

      <div className="actions">
        {/* TODO: point "Sign in" at the app home screen once auth is wired */}
        <Btn label="Sign in" act="signin" onClick={submit}/>

        <div className="or">
          <span>OR</span>
        </div>

        <Btn
          label="Create Account"
          variant="ghost"
          go="createStep1"
          onClick={() => navigate('/register')}
        />
      </div>
    </div>
    </main>
  );

  // return (
  //   <div className="page-enter flex min-h-screen flex-col bg-canvas">
  //     <main className="mx-auto w-full max-w-md flex-1 px-5 pb-10 pt-[calc(3rem+env(safe-area-inset-top,0px))]">
  //       <img src={logoUrl} alt="AskNelson" className="h-9 w-auto" />

  //       <h1 className="mt-8 font-display text-[26px] font-semibold leading-tight text-black">
  //         Welcome back
  //       </h1>
  //       <p className="mt-1.5 text-[14px] leading-relaxed text-gray-500">
  //         Please enter your details below to sign in.
  //       </p>

  //       <form onSubmit={submit} className="mt-7 space-y-4">
  //         <Field
  //           label="Username, email or cell number"
  //           value={identifier}
  //           onChange={(e) => {
  //             setIdentifier(e.target.value)
  //             setError(null)
  //           }}
  //           autoComplete="username"
  //           autoCapitalize="none"
  //           placeholder="you@example.co.za"
  //         />

  //         <PasswordField
  //           value={password}
  //           onChange={(e) => {
  //             setPassword(e.target.value)
  //             setError(null)
  //           }}
  //           autoComplete="current-password"
  //           placeholder="Enter your password"
  //         />

  //         <div className="flex items-center justify-between">
  //           <label className="flex cursor-pointer items-center gap-2 py-2">
  //             <input
  //               type="checkbox"
  //               checked={remember}
  //               onChange={(e) => setRemember(e.target.checked)}
  //               className="h-4 w-4 rounded border-gray-300 accent-[#172B5C]"
  //             />
  //             <span className="text-[13px] text-gray-600">Remember me</span>
  //           </label>
  //           <Link
  //             to="/register"
  //             className="py-2 text-[13px] font-semibold text-brand"
  //             // Password reset isn't built yet; registering again with the same
  //             // contact details is the honest route until it is.
  //             title="Password reset is coming — register again or contact support"
  //           >
  //             Forgot password?
  //           </Link>
  //         </div>

  //         <FormError>{error}</FormError>

  //         <PrimaryButton type="submit" busy={busy} disabled={!identifier.trim() || !password}>
  //           Sign in
  //         </PrimaryButton>
  //       </form>

  //       <p className="mt-6 text-center text-[13px] text-gray-500">
  //         Don't have an account?{' '}
  //         <Link to="/register" className="font-semibold text-brand">
  //           Sign up
  //         </Link>
  //       </p>

  //       <p className="mt-2 text-center text-[13px] text-gray-400">
  //         Or{' '}
  //         <Link to="/explore" className="font-semibold text-gray-500 underline">
  //           keep browsing
  //         </Link>{' '}
  //         — an account is optional.
  //       </p>
  //     </main>
  //   </div>
  // )
}


  
