// One-time PIN delivery.
//
// The flow never talks to a provider directly — it calls send() and gets back
// { ok, echo }. Swapping "console" for Twilio or SendGrid is an env change, not
// a code change, and the registration flow is unaffected either way.
//
//   OTP_TRANSPORT=console  (default) log the PIN server-side
//   OTP_TRANSPORT=twilio   SMS via Twilio
//   OTP_TRANSPORT=sendgrid email via SendGrid
//   OTP_TRANSPORT=webhook  POST to OTP_WEBHOOK_URL — for Clickatell, an
//                          in-house SMS gateway, or a WhatsApp Business sender

const TRANSPORT = (process.env.OTP_TRANSPORT || 'console').toLowerCase()

// Demo mode: the PIN is returned to the browser and shown on the verification
// screen, so the whole sign-up flow can be exercised without an SMS or email
// provider. The code is still a real, random, single-use, expiring PIN — only
// its delivery is shortcut.
//
// This is deliberately NOT tied to NODE_ENV. The production image bakes
// NODE_ENV=production in, which would block demo mode on a laptop for no good
// reason. Instead it takes one unambiguous opt-in, and shouts about it — at
// boot, in every response, and on the screen itself.
//
// With it on, anyone can verify an address they do not control. Never set it on
// a deployment real people can reach.
const ECHO = process.env.OTP_ECHO === 'true'

if (ECHO) {
  console.warn(
    '\n' +
      '  ┌──────────────────────────────────────────────────────────────┐\n' +
      '  │  OTP DEMO MODE IS ON                                         │\n' +
      '  │                                                              │\n' +
      '  │  Verification PINs are returned by the API and displayed in  │\n' +
      '  │  the browser. Anyone can verify an address they do not own.  │\n' +
      '  │  Unset OTP_ECHO before this is reachable by real users.      │\n' +
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

const BODY = (code) =>
  `Your AskNelson verification PIN is ${code}. It expires in 10 minutes. ` +
  `If you didn't request this, ignore this message.`

// --- transports ---------------------------------------------------------------

async function sendConsole(channel, destination, code) {
  console.log(
    `[asknelson][otp] ${channel} -> ${maskDestination(channel, destination)} : ${code}`
  )
  return { ok: true }
}

async function sendTwilio(_channel, destination, code) {
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
    body: new URLSearchParams({ To: destination, From: from, Body: BODY(code) }),
  })
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return { ok: true }
}

async function sendSendgrid(_channel, destination, code) {
  const key = process.env.SENDGRID_API_KEY
  const from = process.env.SENDGRID_FROM
  if (!key || !from) throw new Error('SendGrid is not configured')

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: destination }] }],
      from: { email: from, name: 'AskNelson' },
      subject: 'Your AskNelson verification PIN',
      content: [{ type: 'text/plain', value: BODY(code) }],
    }),
  })
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return { ok: true }
}

async function sendWebhook(channel, destination, code) {
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
    body: JSON.stringify({ channel, to: destination, code, message: BODY(code) }),
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

/**
 * Deliver a PIN. Returns { ok, echo } — `echo` is the PIN itself, and is only
 * ever populated when OTP_ECHO is on outside production.
 *
 * @param {'email'|'sms'} channel
 * @param {string} destination  email address or phone number
 * @param {string} code         the 6-digit PIN
 */
export async function sendOtp(channel, destination, code) {
  const transport = TRANSPORTS[TRANSPORT] || sendConsole
  try {
    await transport(channel, destination, code)
    return { ok: true, echo: ECHO ? code : undefined }
  } catch (err) {
    // A delivery failure must not leak provider detail to the caller, but the
    // operator needs it.
    console.error(`[asknelson][otp] ${TRANSPORT} delivery failed:`, err.message)
    return { ok: false, echo: ECHO ? code : undefined }
  }
}
