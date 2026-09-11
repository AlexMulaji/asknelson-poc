// Outbound messages: verification PINs and password-reset links.
//
// The flows never talk to a provider directly — they call sendOtp() or
// sendResetLink() and get back { ok, echo }. Swapping "console" for Twilio or
// SendGrid is an env change, not a code change.
//
//   OTP_TRANSPORT=console  (default) log the message server-side
//   OTP_TRANSPORT=twilio   SMS via Twilio
//   OTP_TRANSPORT=sendgrid email via SendGrid
//   OTP_TRANSPORT=webhook  POST to OTP_WEBHOOK_URL — for Clickatell, an
//                          in-house SMS gateway, or a WhatsApp Business sender
//
// SMS_TRANSPORT / EMAIL_TRANSPORT override OTP_TRANSPORT per channel, since a
// real deployment usually needs an SMS provider AND an email provider (the
// forgot-password screen offers both).

const TRANSPORT = (process.env.OTP_TRANSPORT || 'console').toLowerCase()
const CHANNEL_TRANSPORT = {
  sms: (process.env.SMS_TRANSPORT || TRANSPORT).toLowerCase(),
  email: (process.env.EMAIL_TRANSPORT || TRANSPORT).toLowerCase(),
}

// Demo mode: the PIN (or reset link) is returned to the browser and shown on
// screen, so the whole flow can be exercised without an SMS or email provider.
// The code is still a real, random, single-use, expiring secret — only its
// delivery is shortcut.
//
// This is deliberately NOT tied to NODE_ENV. The production image bakes
// NODE_ENV=production in, which would block demo mode on a laptop for no good
// reason. Instead it takes one unambiguous opt-in, and shouts about it — at
// boot, in every response, and on the screen itself.
//
// With it on, anyone can verify an address they do not control, or reset the
// password of an account whose number they know. Never set it on a deployment
// real people can reach.
const ECHO = process.env.OTP_ECHO === 'true'

if (ECHO) {
  console.warn(
    '\n' +
      '  ┌──────────────────────────────────────────────────────────────┐\n' +
      '  │  OTP DEMO MODE IS ON                                         │\n' +
      '  │                                                              │\n' +
      '  │  Verification PINs and reset links are returned by the API   │\n' +
      '  │  and displayed in the browser. Anyone can verify an address  │\n' +
      '  │  they do not own. Unset OTP_ECHO before real users arrive.   │\n' +
      '  └──────────────────────────────────────────────────────────────┘\n'
  )
}

export const otpEcho = ECHO
export const otpTransport = TRANSPORT

function maskEmail(email) {
  const [user, domain] = String(email).split('@')
  if (!domain) return '•••'
  return `${user.slice(0, 1)}•••@${domain}`
}

function maskPhone(phone) {
  const d = String(phone).replace(/\D/g, '')
  return `•••• •••${d.slice(-3)}`
}

export function maskDestination(channel, destination) {
  return channel === 'sms' ? maskPhone(destination) : maskEmail(destination)
}

const OTP_MESSAGE = (code) => ({
  subject: 'Your AskNelson verification PIN',
  text:
    `Your AskNelson verification PIN is ${code}. It expires in 10 minutes. ` +
    `If you didn't request this, ignore this message.`,
})

const RESET_MESSAGE = (link, minutes) => ({
  subject: 'Reset your AskNelson password',
  text:
    `Reset your AskNelson password: ${link} — this link expires in ${minutes} minutes. ` +
    `If you didn't ask for this, ignore this message; your password stays the same.`,
})

// --- transports ---------------------------------------------------------------

async function sendConsole(channel, destination, message) {
  console.log(
    `[asknelson][message] ${channel} -> ${maskDestination(channel, destination)} : ${message.text}`
  )
  return { ok: true }
}

async function sendTwilio(_channel, destination, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM
  if (!sid || !token || !from) throw new Error('Twilio is not configured')

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: `+${String(destination).replace(/\D/g, '')}`, From: from, Body: message.text }),
  })
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return { ok: true }
}

async function sendSendgrid(_channel, destination, message) {
  const key = process.env.SENDGRID_API_KEY
  const from = process.env.SENDGRID_FROM
  if (!key || !from) throw new Error('SendGrid is not configured')

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: destination }] }],
      from: { email: from, name: 'AskNelson' },
      subject: message.subject,
      content: [{ type: 'text/plain', value: message.text }],
    }),
  })
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return { ok: true }
}

async function sendWebhook(channel, destination, message, extra) {
  const url = process.env.OTP_WEBHOOK_URL
  if (!url) throw new Error('OTP_WEBHOOK_URL is not set')
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.OTP_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${process.env.OTP_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ channel, to: destination, subject: message.subject, message: message.text, ...extra }),
  })
  if (!res.ok) throw new Error(`Webhook ${res.status}`)
  return { ok: true }
}

const TRANSPORTS = {
  console: sendConsole,
  twilio: sendTwilio,
  sendgrid: sendSendgrid,
  webhook: sendWebhook,
}

async function deliver(channel, destination, message, extra, echoValue) {
  const name = CHANNEL_TRANSPORT[channel] || TRANSPORT
  const transport = TRANSPORTS[name] || sendConsole
  try {
    await transport(channel, destination, message, extra)
    return { ok: true, echo: ECHO ? echoValue : undefined }
  } catch (err) {
    // A delivery failure must not leak provider detail to the caller, but the
    // operator needs it.
    console.error(`[asknelson][message] ${name} delivery failed:`, err.message)
    return { ok: false, echo: ECHO ? echoValue : undefined }
  }
}

/**
 * Deliver a PIN. Returns { ok, echo } — `echo` is the PIN itself, and is only
 * populated when OTP_ECHO is on.
 *
 * @param {'email'|'sms'} channel
 * @param {string} destination  email address or phone number
 * @param {string} code         the 6-digit PIN
 */
export function sendOtp(channel, destination, code) {
  return deliver(channel, destination, OTP_MESSAGE(code), { code, kind: 'otp' }, code)
}

/** Deliver a password-reset link. `echo` is the link, under OTP_ECHO only. */
export function sendResetLink(channel, destination, link, minutes) {
  return deliver(channel, destination, RESET_MESSAGE(link, minutes), { link, kind: 'password_reset' }, link)
}
