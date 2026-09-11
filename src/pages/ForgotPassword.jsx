import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { requestPasswordReset } from '../lib/authApi.js'
import { track } from '../lib/analytics.js'
import { isEmail, isMobile } from '../lib/validation.js'
import {
  Alert,
  BackBtn,
  Btn,
  DemoNote,
  Field,
  HelpFoot,
  Hgroup,
  Logo,
  Option,
  Resend,
} from '../components/auth/authPrims.jsx'
import '../assets/auth/auth_style.css'

// Forgot Password — the Figma flow: choose Cellphone or Email, enter it, and a
// reset link is sent there.
//
// The design's "Account not found" state only appears when the server runs
// with AUTH_REVEAL_UNKNOWN_ACCOUNTS=true. By default the server answers the
// same way whether or not an account exists — otherwise this form would tell
// anyone with a phone number whether its owner uses an EAP service.

const CALL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M15.5 21a1.5 1.5 0 001.5-1.5v-3.2a1.5 1.5 0 00-1.18-1.47l-2.3-.5a1.5 1.5 0 00-1.46.5l-.9 1.06a13.6 13.6 0 01-4.05-4.05l1.06-.9a1.5 1.5 0 00.5-1.46l-.5-2.3A1.5 1.5 0 007.7 5H4.5A1.5 1.5 0 003 6.5C3 14.5 8.5 21 15.5 21Z"
      stroke="#637885"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const EMAIL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2Z"
      stroke="#637885"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.5 7.2l8.42 5.62a2 2 0 002.16 0L21.5 7.2"
      stroke="#637885"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const COPY = {
  cell: {
    channel: 'sms',
    sub: 'Enter your mobile number and we will send you a link to reset your password.',
    field: { id: 'fp-mobile', label: 'Mobile Number', hint: 'e.g. 012 345 6789', type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
    invalid: 'Enter your 10-digit mobile number.',
    isValid: isMobile,
    failTitle: 'Account not found',
    failText:
      'There’s no account associated with the number you have provided. Please check details and try again.',
    okTitle: 'Check your messages',
    okText: 'We have sent you a link to reset your password. Please check your messages.',
  },
  email: {
    channel: 'email',
    sub: 'Enter your email address and we will send you a link to reset your password.',
    field: { id: 'fp-email', label: 'Email Address', hint: 'name@example.com', type: 'email', inputMode: 'email', autoComplete: 'email' },
    invalid: 'Enter a valid email address.',
    isValid: isEmail,
    failTitle: 'Account not found',
    failText:
      'There’s no account associated with the email you have provided. Please check your details and try again.',
    okTitle: 'Check your email',
    okText: 'We have sent you a link to reset your password. Please check your inbox and spam folder.',
  },
}

export default function ForgotPassword() {
  const navigate = useNavigate()
  const [method, setMethod] = useState('cell') // cell | email
  const [step, setStep] = useState('choose') // choose | enter
  const [contact, setContact] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | sent | notFound
  const [error, setError] = useState(null)
  const [devLink, setDevLink] = useState(null)

  const c = COPY[method]
  const helpFoot = <HelpFoot onClick={() => navigate('/asknelson')} />

  async function send() {
    if (!c.isValid(contact)) {
      setError(c.invalid)
      return
    }
    setStatus('sending')
    setError(null)
    try {
      const result = await requestPasswordReset(c.channel, contact.trim())
      setDevLink(result.devLink ?? null)
      setStatus('sent')
      track('password_reset_requested', { channel: c.channel })
    } catch (err) {
      if (err.status === 404) {
        setStatus('notFound')
      } else {
        setError(err.message)
        setStatus('idle')
      }
    }
  }

  if (step === 'choose') {
    return (
      <main className="screen screen--forgot">
        <BackBtn onClick={() => navigate('/login')} />
        <div className="screen__inner">
          <Logo />
          <Hgroup
            title="Forgot Password"
            sub="Choose how you would like to receive your password reset link."
            long
          />

          <div className="body-block">
            <div className="options" role="radiogroup" aria-label="Reset link delivery method">
              <Option
                id="cell"
                icon={CALL_ICON}
                title="Cellphone"
                desc="Send a reset link to your mobile number"
                selected={method === 'cell'}
                onSelect={() => setMethod('cell')}
              />
              <Option
                id="email"
                icon={EMAIL_ICON}
                title="Email"
                desc="Send a reset link to your email address"
                selected={method === 'email'}
                onSelect={() => setMethod('email')}
              />
            </div>

            <Btn label="Continue" onClick={() => setStep('enter')} />
          </div>
        </div>
      </main>
    )
  }

  const sent = status === 'sent'

  return (
    <main className="screen screen--forgot">
      <BackBtn
        onClick={() => {
          setStep('choose')
          setStatus('idle')
          setError(null)
        }}
      />
      <form
        className="screen__inner"
        onSubmit={(e) => {
          e.preventDefault()
          if (sent) navigate('/login')
          else send()
        }}
        noValidate
      >
        <Logo />
        <Hgroup title="Forgot Password" sub={c.sub} long />

        <div className="body-block">
          <div className="stack">
            <div className="fields">
              <Field
                {...c.field}
                value={contact}
                error={error}
                onChange={(e) => {
                  setContact(e.target.value)
                  setError(null)
                  if (status !== 'sending') setStatus('idle')
                }}
              />
            </div>
            {sent ? <Resend onClick={send} /> : null}
          </div>

          {status === 'notFound' ? <Alert kind="error" title={c.failTitle} text={c.failText} /> : null}
          {sent ? <Alert kind="success" title={c.okTitle} text={c.okText} /> : null}
          {sent && devLink ? (
            <DemoNote>
              <a
                href={devLink}
                onClick={(e) => {
                  e.preventDefault()
                  const url = new URL(devLink)
                  navigate(url.pathname + url.search)
                }}
              >
                Open the reset link
              </a>
            </DemoNote>
          ) : null}

          <div className="stack" style={{ gap: '21px' }}>
            {sent ? (
              <Btn type="submit" label="Finish" />
            ) : (
              <Btn type="submit" label={status === 'sending' ? 'Sending' : 'Send Reset Link'} loading={status === 'sending'} />
            )}
            {helpFoot}
          </div>
        </div>
      </form>
    </main>
  )
}
