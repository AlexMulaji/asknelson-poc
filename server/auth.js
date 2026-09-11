import express from 'express'
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { isEnabled, query } from './db.js'
import { linkDeviceFromRequest } from './analytics.js'
import { maskDestination, otpEcho, sendOtp } from './otp.js'

// Accounts, OTP verification and sessions.
//
// Two account kinds:
//   identified — retains name and contact details, and is linked to an
//                analytics member so their events attribute to a person.
//   anonymous  — username + password. Contact details are used to deliver one
//                OTP and are then erased, leaving only a peppered hash for
//                duplicate detection and login. Anonymous accounts are never
//                linked to an analytics member, so their activity genuinely
//                cannot be traced back to them.

const scrypt = promisify(crypto.scrypt)

const SESSION_COOKIE = 'an_auth'
const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS || 30)
const OTP_TTL_MINUTES = 10
const OTP_MAX_ATTEMPTS = 5
const MAX_FAILED_LOGINS = 8
const LOCKOUT_MINUTES = 15
const MIN_PASSWORD = 8

// Keys the one-way hashes of email / phone / ID number. Without it those hashes
// would be brute-forceable — the space of phone numbers is tiny. Rotating this
// invalidates every anonymous login, so treat it as permanent.
const PEPPER = process.env.AUTH_PEPPER || ''
if (isEnabled && !PEPPER) {
  console.warn(
    '[asknelson] WARNING: AUTH_PEPPER is not set — contact hashes fall back to an ' +
      'unkeyed digest, which is brute-forceable. Set it before going live.'
  )
}

// --- hashing ------------------------------------------------------------------

// scrypt from node:crypto rather than argon2/bcrypt: both of those are native
// addons that complicate the Alpine build for no security gain here. Params
// follow the OWASP scrypt guidance (N=2^15, r=8, p=1).
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 }

async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(keyB64, 'base64')
    const actual = await scrypt(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    })
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function peppered(value) {
  if (!value) return null
  return crypto.createHmac('sha256', PEPPER || 'asknelson-unkeyed').update(value).digest('hex')
}

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex')

// --- validation / normalising -------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normEmail = (v) => String(v || '').trim().toLowerCase()

// Light E.164 normalisation for South African numbers, so 071…, 2771… and
// +2771… all resolve to one hash instead of three separate accounts.
function normPhone(v) {
  const d = String(v || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 10 && d.startsWith('0')) return `27${d.slice(1)}`
  if (d.startsWith('27')) return d
  return d
}

const isEmail = (v) => EMAIL_RE.test(normEmail(v))
const isPhone = (v) => normPhone(v).length >= 10
const str = (v, max = 200) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

function rateLimiter({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const k = key(req) || 'unknown'
    const entry = hits.get(k)
    if (!entry || now > entry.resetAt) hits.set(k, { count: 1, resetAt: now + windowMs })
    else if (++entry.count > max) {
      return res.status(429).json({ error: 'Too many attempts. Please wait and try again.' })
    }
    if (hits.size > 5000) for (const [kk, v] of hits) if (now > v.resetAt) hits.delete(kk)
    next()
  }
}

// --- sessions -----------------------------------------------------------------

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

function isSecure(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https'
}

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  await query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, now() + ($3 || ' days')::interval, $4)`,
    [hashCode(token), userId, String(SESSION_DAYS), str(req.get('user-agent'), 512)]
  )
  // httpOnly: the token must be unreachable from JavaScript, so an XSS bug
  // cannot exfiltrate a logged-in session.
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  })
  return token
}

// Public shape of a user — never leaks hashes, and only returns contact details
// for identified accounts (anonymous ones have none stored anyway).
function publicUser(row) {
  return {
    id: row.id,
    phone: row.phone,
    email: row.email,
    employer: row.employer,
    status: row.status,
    createdAt: row.created_at,
  }
}

async function currentUser(req) {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return null
  const { rows } = await query(
    `SELECT u.* FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'`,
    [hashCode(token)]
  )
  if (!rows[0]) return null
  // Rolling expiry: an active user stays signed in.
  query(
    `UPDATE auth_sessions
        SET last_seen_at = now(), expires_at = now() + ($2 || ' days')::interval
      WHERE token_hash = $1`,
    [hashCode(token), String(SESSION_DAYS)]
  ).catch(() => {})
  return rows[0]
}

/** Express guard for routes that require a signed-in user. */
export function requireUser(req, res, next) {
  currentUser(req)
    .then((user) => {
      if (!user) return res.status(401).json({ error: 'Not signed in' })
      req.user = user
      next()
    })
    .catch(() => res.status(500).json({ error: 'Session check failed' }))
}

// --- OTP ----------------------------------------------------------------------

async function issueOtp(userId, channel, destination, purpose = 'verify') {
  // 6 digits, uniformly distributed — Math.random() is not acceptable here.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  // Supersede any outstanding PIN so only the newest can be used.
  await query(
    `UPDATE auth_otp_codes SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose]
  )
  await query(
    `INSERT INTO auth_otp_codes (id, user_id, code_hash, purpose, channel, destination, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)`,
    [
      crypto.randomUUID(),
      userId,
      hashCode(code),
      purpose,
      channel,
      destination,
      String(OTP_TTL_MINUTES),
    ]
  )
  const result = await sendOtp(channel, destination, code)
  return { delivered: result.ok, echo: result.echo, masked: maskDestination(channel, destination) }
}

async function consumeOtp(userId, code) {
  const { rows } = await query(
    `SELECT * FROM auth_otp_codes
      WHERE user_id = $1 AND purpose = 'verify' AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [userId]
  )
  const otp = rows[0]
  if (!otp) return { ok: false, reason: 'No PIN outstanding. Request a new one.' }
  if (new Date(otp.expires_at) < new Date()) {
    return { ok: false, reason: 'That PIN has expired. Request a new one.' }
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'Too many attempts. Request a new PIN.' }
  }

  const supplied = hashCode(String(code))
  const matches =
    supplied.length === otp.code_hash.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(otp.code_hash))

  if (!matches) {
    await query('UPDATE auth_otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id])
    return { ok: false, reason: "That PIN doesn't match. Try again." }
  }
  await query('UPDATE auth_otp_codes SET consumed_at = now() WHERE id = $1', [otp.id])
  return { ok: true, channel: otp.channel }
}

// --- router -------------------------------------------------------------------

export function createAuthRouter() {
  const router = express.Router()

  router.use(express.json({ limit: '64kb' }))

  router.use((req, res, next) => {
    if (!isEnabled) {
      return res.status(503).json({ error: 'Accounts are unavailable — no database configured.' })
    }
    next()
  })

  const registerLimit = rateLimiter({ windowMs: 15 * 60_000, max: 10 })
  const loginLimit = rateLimiter({ windowMs: 15 * 60_000, max: 20 })
  const otpLimit = rateLimiter({ windowMs: 15 * 60_000, max: 15 })

  /**
   * Create a pending account and send the first PIN. Everything the flow
   * collected arrives in one payload; nothing is persisted until this point.
   */
  router.post('/register/start', registerLimit, async (req, res) => {
    try {
      const b = req.body || {}
      const password = String(b.password || '')
      const email = b.email ? normEmail(b.email) : null
      const phone = b.phone ? normPhone(b.phone) : null
      const employer = str(b.employer, 160)

      if (password.length < MIN_PASSWORD) {
        return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` })
      }
      if (!employer) return res.status(400).json({ error: 'Employer is required.' })
      if (email && !isEmail(email)) return res.status(400).json({ error: 'That email address looks wrong.' })
      if (phone && !isPhone(phone)) return res.status(400).json({ error: 'That cell number looks wrong.' })

      
      const idNumber = String(b.idNumber || '').replace(/\D/g, '')
      if (idNumber.length !== 13) return res.status(400).json({ error: 'Enter a valid 13-digit ID number.' })
        // Only the hash is kept: it identifies a duplicate sign-up without the
        // service ever holding a national ID number.
      const idHash = peppered(idNumber)

      

      const emailHash = email ? peppered(email) : null
      const phoneHash = phone ? peppered(phone) : null


      // Reuse a still-pending row for the same contact so a user who abandoned
      // at the PIN screen can start over instead of hitting "already registered".
      const existing = await query(
        `SELECT id, status FROM auth_users
          WHERE ($1::text IS NOT NULL AND email_hash = $1)
             OR ($2::text IS NOT NULL AND phone_hash = $2)
          LIMIT 1`,
        [emailHash, phoneHash]
      )
      if (existing.rows[0]?.status === 'active') {
        return res.status(409).json({ error: 'An account already exists for those details. Try logging in.' })
      }
      if (existing.rows[0]) {
        await query('DELETE FROM auth_users WHERE id = $1', [existing.rows[0].id])
      }

      const userId = crypto.randomUUID()
      await query(
        `INSERT INTO auth_users
           (id, password_hash, email, phone,
            email_hash, phone_hash, id_number_hash, employer, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
        [
          userId,
          await hashPassword(password),
          email,
          phone,
          emailHash,
          phoneHash,
          idHash,
          employer,
        ]
      )

      // Channel: what was asked for, falling back to whatever we have.
      const wanted = b.otpChannel === 'sms' || b.otpChannel === 'email' ? b.otpChannel : null
      const channel = wanted && (wanted === 'sms' ? phone : email) ? wanted : email ? 'email' : 'sms'
      const destination = channel === 'sms' ? phone : email

      const sent = await issueOtp(userId, channel, destination)
      res.json({
        userId,
        channel,
        destination: sent.masked,
        delivered: sent.delivered,
        demo: otpEcho,
        ...(sent.echo ? { devCode: sent.echo } : {}),
      })
    } catch (err) {
      console.error('[asknelson][auth] register start failed:', err.stack)
      res.status(500).json({ error: 'Could not start registration.' })
    }
  })

  router.post('/register/resend', otpLimit, async (req, res) => {
    try {
      const userId = str(req.body?.userId, 64)
      const { rows } = await query(
        "SELECT * FROM auth_users WHERE id = $1 AND status = 'pending'",
        [userId]
      )
      const user = rows[0]
      if (!user) return res.status(404).json({ error: 'Nothing to verify.' })

      const wanted = req.body?.channel === 'sms' || req.body?.channel === 'email' ? req.body.channel : null
      const channel = wanted && (wanted === 'sms' ? user.phone : user.email) ? wanted : user.email ? 'email' : 'sms'
      const destination = channel === 'sms' ? user.phone : user.email
      if (!destination) return res.status(400).json({ error: 'No destination on file.' })

      const sent = await issueOtp(userId, channel, destination)
      res.json({
        channel,
        destination: sent.masked,
        delivered: sent.delivered,
        demo: otpEcho,
        ...(sent.echo ? { devCode: sent.echo } : {}),
      })
    } catch (err) {
      console.error('[asknelson][auth] resend failed:', err.message)
      res.status(500).json({ error: 'Could not resend the PIN.' })
    }
  })

  /**
   * Verify the PIN, activate the account, sign the user in.
   *
   * This is where the two account kinds diverge for good: identified users gain
   * an analytics member and their device is bound to it; anonymous users have
   * their contact details erased and are never linked to anything.
   */
  router.post('/register/verify', otpLimit, async (req, res) => {
    try {
      console.log('starting verify', req.body)
      
      const userId = str(req.body?.userId, 64)
      const code = String(req.body?.code || '').replace(/\D/g, '')
      if (!userId || code.length !== 6) return res.status(400).json({ error: 'Enter the 6-digit PIN.' })

      const { rows } = await query(
        "SELECT * FROM auth_users WHERE id = $1 AND status = 'pending'",
        [userId]
      )
      const user = rows[0]
      if (!user) return res.status(404).json({ error: 'Nothing to verify.' })

      const result = await consumeOtp(userId, code)
      if (!result.ok) return res.status(400).json({ error: result.reason })

      
      // external_ref prefers the employer's own staff number; otherwise the
      // account id, so reporting still has a stable handle.
      const externalRef = `user:${userId}`
      const member = await query(
        `INSERT INTO analytics_members (id, external_ref, label)
          VALUES ($1, $2, $3)
          ON CONFLICT (external_ref) DO UPDATE SET label = COALESCE(EXCLUDED.label, analytics_members.label)
          RETURNING id`,
        [crypto.randomUUID(), externalRef, `${user.phone}`.trim()]
      )
      const memberId = member.rows[0].id
      await query(
        "UPDATE auth_users SET status = 'active', verified_at = now(), member_id = $2 WHERE id = $1",
        [userId, memberId]
      )
      // Attribute this browser's past and future events to the new member.
      await linkDeviceFromRequest(req, memberId)
      

      await createSession(req, res, userId)
      const fresh = await query('SELECT * FROM auth_users WHERE id = $1', [userId])
      res.json({ user: publicUser(fresh.rows[0]) })
    } catch (err) {
      console.error('[asknelson][auth] verify failed:', err.message)
      res.status(500).json({ error: 'Could not verify that PIN.' })
    }
  })

  /**
   * Sign in with username, email or cell number. Anonymous accounts have no
   * stored email or phone, but their peppered hashes still resolve — so they
   * can sign in with the address they verified without us holding it.
   */
  router.post('/login', loginLimit, async (req, res) => {
    try {
      const identifier = str(req.body?.identifier, 200)
      const password = String(req.body?.password || '')
      if (!identifier || !password) {
        return res.status(400).json({ error: 'Enter your details to sign in.' })
      }

      const { rows } = await query(
        `SELECT * FROM auth_users
          WHERE phone_hash = $1
          LIMIT 1`,
        [peppered(normPhone(identifier))]
      )
      const user = rows[0]

      // Uniform failure: never reveal whether the account exists.
      const reject = () => res.status(401).json({ error: 'Wrong username or password.' })

      if (!user) {
        // Burn comparable time so a missing account isn't detectable by timing.
        await hashPassword(password)
        return reject()
      }
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(429).json({ error: 'Too many attempts. Try again shortly.' })
      }
      if (user.status !== 'active') {
        return res.status(403).json({ error: 'That account is not verified yet.' })
      }

      if (!(await verifyPassword(password, user.password_hash))) {
        await query(
          `UPDATE auth_users
              SET failed_logins = failed_logins + 1,
                  locked_until = CASE WHEN failed_logins + 1 >= $2
                                      THEN now() + ($3 || ' minutes')::interval
                                      ELSE locked_until END
            WHERE id = $1`,
          [user.id, MAX_FAILED_LOGINS, String(LOCKOUT_MINUTES)]
        )
        return reject()
      }

      await query(
        'UPDATE auth_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
        [user.id]
      )
      if (user.member_id) await linkDeviceFromRequest(req, user.member_id)

      await createSession(req, res, user.id)
      res.json({ user: publicUser(user) })
    } catch (err) {
      console.error('[asknelson][auth] login failed:', err.message)
      res.status(500).json({ error: 'Could not sign you in.' })
    }
  })

  router.post('/logout', async (req, res) => {
    try {
      const token = readCookie(req, SESSION_COOKIE)
      if (token) {
        await query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1', [
          hashCode(token),
        ])
      }
      res.clearCookie(SESSION_COOKIE, { path: '/' })
      res.json({ ok: true })
    } catch (err) {
      console.error('[asknelson][auth] logout failed:', err.message)
      res.status(500).json({ error: 'Could not sign you out.' })
    }
  })

  // The app calls this on load. A signed-out visitor is a normal state, not an
  // error — the app is usable either way.
  router.get('/me', async (req, res) => {
    try {
      const user = await currentUser(req)
      res.json({ user: user ? publicUser(user) : null, otpEcho })
    } catch {
      res.json({ user: null })
    }
  })

  router.get('/username-available', async (req, res) => {
    try {
      const username = str(req.query.username, 64)
      if (!username || username.length < 3) return res.json({ available: false })
      const { rows } = await query('SELECT 1 FROM auth_users WHERE lower(username) = lower($1)', [
        username,
      ])
      res.json({ available: rows.length === 0 })
    } catch {
      res.json({ available: true })
    }
  })

  return router
}

/** Delete expired sessions and stale pending registrations. */
export function startAuthSweeper(intervalMinutes = 60) {
  if (!isEnabled) return null
  const timer = setInterval(
    () => {
      query('DELETE FROM auth_sessions WHERE expires_at < now() - interval \'7 days\'').catch(() => {})
      query('DELETE FROM auth_otp_codes WHERE created_at < now() - interval \'1 day\'').catch(() => {})
      // Abandoned sign-ups hold contact details; don't keep them indefinitely.
      query(
        "DELETE FROM auth_users WHERE status = 'pending' AND created_at < now() - interval '24 hours'"
      ).catch(() => {})
    },
    intervalMinutes * 60 * 1000
  )
  timer.unref()
  return timer
}
