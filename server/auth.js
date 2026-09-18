import express from 'express'
import crypto from 'node:crypto'
import { isEnabled, query, withTransaction } from './db.js'
import { aad, blindIndex, open, pepperConfigured, seal } from './crypto.js'
import { DEVICE_COOKIE, linkDeviceFromRequest, memberActivity, upsertMember } from './analytics.js'
import { maskDestination, otpEcho, sendOtp, sendResetLink } from './otp.js'
import { audit } from './audit.js'
import { allocateUsername } from './username.js'
import { hashPassword, passwordProblem, verifyPassword } from './passwords.js'
import { baseUrl, noStore, rateLimiter, readCookie, str } from './http.js'
import {
  SESSION_COOKIE,
  USER_SELECT,
  createSession,
  currentUser,
  endSession,
  requireUser,
  sha256,
} from './session.js'
import { progressSnapshot } from './progress.js'

// Accounts, OTP verification, password reset and the POPIA data-subject
// rights (access and deletion).
//
// Two account kinds:
//   identified — the Figma sign-up: mobile number, optional email, SA ID
//                number and company. Contact details are kept, encrypted, and
//                the account is linked to an analytics member so events
//                attribute to a person. The ID number itself is never stored,
//                only a keyed hash for duplicate detection.
//   anonymous  — username + password (API only; not in the current design).
//                Contact details are used to deliver one OTP and are then
//                erased, leaving only keyed hashes for login. Never linked to
//                an analytics member, so activity cannot be traced back.
//
// Every contact detail and name is sealed with AES-256-GCM (see crypto.js)
// and found again through a keyed hash (email_hash, phone_hash).

const OTP_TTL_MINUTES = 10
const OTP_MAX_ATTEMPTS = 5
const RESET_TTL_MINUTES = 30
const MAX_FAILED_LOGINS = 8
const LOCKOUT_MINUTES = 15

// Consent is recorded against this version; bump it when the notice changes.
export const PRIVACY_NOTICE_VERSION = process.env.PRIVACY_NOTICE_VERSION || '2026-09'
// What a registering user consents to (POPIA s11, and s27(1)(a) for the
// assessment results, which are health information).
const CONSENT_PURPOSES = ['privacy_notice', 'health_information']

// The forgot-password design has an "Account not found" state. Showing it
// tells anyone holding a phone number whether its owner uses an EAP — itself
// sensitive — so by default the response is the same either way. Set to true
// to show the design's not-found state.
const REVEAL_UNKNOWN_ACCOUNTS = process.env.AUTH_REVEAL_UNKNOWN_ACCOUNTS === 'true'

// Off for now: any 13 digits is accepted as an ID number. Set to true to
// require a real South African ID (valid date of birth and check digit).
const STRICT_SA_ID = process.env.AUTH_STRICT_SA_ID === 'true'

if (isEnabled && !pepperConfigured) {
  console.warn(
    '[asknelson] WARNING: AUTH_PEPPER is not set — contact hashes fall back to an ' +
      'unkeyed digest, which is brute-forceable. Set it before going live.'
  )
}

// Contact and ID hashes use the original, un-namespaced scheme so hashes
// written before encryption was introduced still match.
const peppered = (value) => blindIndex(value)

// --- validation / normalising -------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const normEmail = (v) => String(v || '').trim().toLowerCase()

// Light E.164 normalisation for South African numbers, so 071…, 2771… and
// +2771… all resolve to one hash instead of three separate accounts.
function normPhone(v) {
  const d = String(v || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 10 && d.startsWith('0')) return `27${d.slice(1)}`
  return d
}

const isEmail = (v) => EMAIL_RE.test(normEmail(v))
const isPhone = (v) => normPhone(v).length >= 10

// A South African ID number: YYMMDD, then 7 digits, the last a Luhn check
// digit. Catches typos before they become a permanent duplicate-check hash.
export function isValidSaId(id) {
  if (!/^\d{13}$/.test(id)) return false
  const month = Number(id.slice(2, 4))
  const day = Number(id.slice(4, 6))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  let sum = 0
  for (let i = 0; i < 13; i++) {
    let digit = Number(id[12 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

// --- encrypted user fields ----------------------------------------------------

const userCtx = (userId, column) => aad('auth_users', column, userId)
const sealUserField = (userId, column, value) => seal(value, userCtx(userId, column))
const userField = (row, column) => open(row[`${column}_enc`], userCtx(row.id, column))

// Public shape of a user — never leaks hashes. Anonymous accounts have no
// contact details stored, so theirs come back null.
function publicUser(row) {
  return {
    id: row.id,
    isAnonymous: row.is_anonymous,
    username: row.username,
    firstName: userField(row, 'first_name'),
    lastName: userField(row, 'last_name'),
    email: userField(row, 'email'),
    phone: userField(row, 'phone'),
    employer: row.organisation_name ?? null,
    employeeNo: userField(row, 'employee_no'),
    status: row.status,
    createdAt: row.created_at,
  }
}

async function loadUser(userId) {
  const { rows } = await query(`${USER_SELECT} WHERE u.id = $1`, [userId])
  return rows[0] ?? null
}

async function upsertOrganisation(db, name) {
  const { rows } = await db.query(
    `INSERT INTO organisations (id, name, name_key) VALUES ($1, $2, $3)
     ON CONFLICT (name_key) DO UPDATE SET name = organisations.name
     RETURNING id`,
    [crypto.randomUUID(), name, name.toLowerCase().replace(/\s+/g, ' ').trim()]
  )
  return rows[0].id
}

// --- OTP ----------------------------------------------------------------------

async function issueOtp(userId, channel, destination, purpose = 'verify') {
  // 6 digits, uniformly distributed — Math.random() is not acceptable here.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const masked = maskDestination(channel, destination)
  // Supersede any outstanding PIN so only the newest can be used.
  await query(
    `UPDATE auth_otp_codes SET consumed_at = now()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose]
  )
  await query(
    `INSERT INTO auth_otp_codes (id, user_id, code_hash, purpose, channel, destination_masked, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + $7::interval)`,
    [crypto.randomUUID(), userId, sha256(code), purpose, channel, masked, `${OTP_TTL_MINUTES} minutes`]
  )
  const result = await sendOtp(channel, destination, code)
  return { delivered: result.ok, echo: result.echo, masked }
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
    return { ok: false, reason: 'That code has expired. Request a new one.' }
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'Too many attempts. Request a new code.' }
  }

  const supplied = sha256(String(code))
  const matches =
    supplied.length === otp.code_hash.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(otp.code_hash))

  if (!matches) {
    await query('UPDATE auth_otp_codes SET attempts = attempts + 1 WHERE id = $1', [otp.id])
    return { ok: false, reason: "That code doesn't match. Try again." }
  }
  await query('UPDATE auth_otp_codes SET consumed_at = now() WHERE id = $1', [otp.id])
  return { ok: true, channel: otp.channel }
}

// Which channel to use: what was asked for if we have it, else SMS — the
// design verifies against the mobile number.
function pickChannel(wanted, phone, email) {
  if (wanted === 'sms' && phone) return 'sms'
  if (wanted === 'email' && email) return 'email'
  return phone ? 'sms' : 'email'
}

const otpResponse = (channel, sent) => ({
  channel,
  destination: sent.masked,
  delivered: sent.delivered,
  demo: otpEcho,
  ...(sent.echo ? { devCode: sent.echo } : {}),
})

// --- router -------------------------------------------------------------------

export function createAuthRouter() {
  const router = express.Router()

  router.use(express.json({ limit: '64kb' }))
  router.use(noStore)

  router.use((req, res, next) => {
    if (!isEnabled) {
      return res.status(503).json({ error: 'Accounts are unavailable — no database configured.' })
    }
    next()
  })

  const registerLimit = rateLimiter({ windowMs: 15 * 60_000, max: 10, message: 'Too many attempts. Please wait and try again.' })
  const loginLimit = rateLimiter({ windowMs: 15 * 60_000, max: 20, message: 'Too many attempts. Please wait and try again.' })
  const otpLimit = rateLimiter({ windowMs: 15 * 60_000, max: 15, message: 'Too many attempts. Please wait and try again.' })
  const resetIpLimit = rateLimiter({ windowMs: 60 * 60_000, max: 10, message: 'Too many reset requests. Please wait and try again.' })
  // Per destination too, so nobody can use the form to flood one number.
  const resetTargetLimit = rateLimiter({
    windowMs: 60 * 60_000,
    max: 3,
    key: (req) => `reset:${String(req.body?.identifier || '').replace(/\s/g, '').toLowerCase()}`,
    message: 'We have already sent a few links. Please check your messages or try again later.',
  })
  const sensitiveLimit = rateLimiter({ windowMs: 15 * 60_000, max: 5, message: 'Too many attempts. Please wait and try again.' })

  /**
   * Create a pending account and send the first PIN. Everything the sign-up
   * screens collected arrives in one payload; nothing is persisted before this.
   */
  router.post('/register/start', registerLimit, async (req, res) => {
    try {
      const b = req.body || {}
      const anonymous = Boolean(b.anonymous)
      const password = String(b.password || '')
      const email = b.email ? normEmail(b.email) : null
      const phone = b.phone ? normPhone(b.phone) : null
      const company = str(b.company ?? b.employer, 160)
      const employeeNo = str(b.employeeNo, 64)
      const bad = (message) => res.status(400).json({ error: message })

      if (b.consent !== true) return bad('Please accept the privacy notice to continue.')
      const weak = passwordProblem(password)
      if (weak) return bad(weak)
      if (!company) return bad('Company name is required.')
      if (email && !isEmail(email)) return bad('That email address looks wrong.')
      if (phone && !isPhone(phone)) return bad('That mobile number looks wrong.')
      if (anonymous && !email && !phone) return bad('Give us an email or a mobile number so we can verify you.')
      if (!anonymous && !phone) return bad('Your mobile number is required.')

      let username = null
      let firstName = null
      let lastName = null
      let idHash = null

      if (anonymous) {
        username = str(b.username, 64)
        if (!username || username.length < 3) return bad('Choose a username of at least 3 characters.')
        const { rows } = await query('SELECT 1 FROM auth_users WHERE lower(username) = lower($1)', [username])
        if (rows.length) return res.status(409).json({ error: 'That username is taken.' })
      } else {
        // Identified accounts do not choose a handle; one is generated for them
        // in the transaction below.
        firstName = str(b.firstName, 80)
        lastName = str(b.lastName, 80)
        const idNumber = String(b.idNumber || '').replace(/\D/g, '')
        if (idNumber.length !== 13) return bad('Your ID number should be 13 digits.')
        if (STRICT_SA_ID && !isValidSaId(idNumber)) {
          return bad("That isn't a valid South African ID number. Please check each digit.")
        }
        // Only the keyed hash is kept: it identifies a duplicate sign-up
        // without the service ever holding a national ID number.
        idHash = peppered(idNumber)
      }

      const emailHash = email ? peppered(email) : null
      const phoneHash = phone ? peppered(phone) : null

      const { rows: clashes } = await query(
        `SELECT id, status FROM auth_users
          WHERE ($1::text IS NOT NULL AND email_hash = $1)
             OR ($2::text IS NOT NULL AND phone_hash = $2)
             OR ($3::text IS NOT NULL AND id_number_hash = $3)`,
        [emailHash, phoneHash, idHash]
      )
      if (clashes.some((r) => r.status !== 'pending')) {
        return res.status(409).json({ error: 'An account already exists for those details. Try signing in.' })
      }

      const userId = crypto.randomUUID()
      const passwordHash = await hashPassword(password)
      await withTransaction(async (db) => {
        // A still-pending row for the same person is an abandoned attempt at
        // the code screen: replace it rather than blocking them.
        if (clashes.length) {
          await db.query('DELETE FROM auth_users WHERE id = ANY($1::uuid[])', [clashes.map((r) => r.id)])
        }
        const organisationId = await upsertOrganisation(db, company)
        // The handle the app shows wherever a name is needed. Before this,
        // that fell back to the member's own mobile number, which then sat on
        // the home screen for anyone glancing at the phone to read. Allocated
        // in here so the uniqueness check and the INSERT see one snapshot; the
        // UNIQUE index catches the race if two sign-ups land on the same one.
        if (!anonymous) username = await allocateUsername(db)
        await db.query(
          `INSERT INTO auth_users
             (id, is_anonymous, username, password_hash, email_enc, phone_enc, first_name_enc,
              last_name_enc, employee_no_enc, email_hash, phone_hash, id_number_hash,
              organisation_id, password_changed_at, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),'pending')`,
          [
            userId,
            anonymous,
            username,
            passwordHash,
            sealUserField(userId, 'email', email),
            sealUserField(userId, 'phone', phone),
            sealUserField(userId, 'first_name', firstName),
            sealUserField(userId, 'last_name', lastName),
            sealUserField(userId, 'employee_no', employeeNo),
            emailHash,
            phoneHash,
            idHash,
            organisationId,
          ]
        )
        for (const purpose of CONSENT_PURPOSES) {
          await db.query(
            `INSERT INTO user_consents (id, user_id, purpose, notice_version, granted)
             VALUES ($1, $2, $3, $4, true)`,
            [crypto.randomUUID(), userId, purpose, PRIVACY_NOTICE_VERSION]
          )
        }
      })

      const channel = pickChannel(b.otpChannel, phone, email)
      const sent = await issueOtp(userId, channel, channel === 'sms' ? phone : email)
      audit(req, { actor: 'anonymous', action: 'registration_started', targetType: 'user', targetId: userId })
      res.json({ userId, ...otpResponse(channel, sent) })
    } catch (err) {
      console.error('[asknelson][auth] register start failed:', err.message)
      res.status(500).json({ error: 'Could not start registration.' })
    }
  })

  router.post('/register/resend', otpLimit, async (req, res) => {
    try {
      const userId = str(req.body?.userId, 64)
      if (!UUID_RE.test(userId || '')) return res.status(404).json({ error: 'Nothing to verify.' })
      const { rows } = await query("SELECT * FROM auth_users WHERE id = $1 AND status = 'pending'", [userId])
      const user = rows[0]
      if (!user) return res.status(404).json({ error: 'Nothing to verify.' })

      const phone = userField(user, 'phone')
      const email = userField(user, 'email')
      const channel = pickChannel(req.body?.channel, phone, email)
      const destination = channel === 'sms' ? phone : email
      if (!destination) return res.status(400).json({ error: 'No destination on file.' })

      const sent = await issueOtp(userId, channel, destination)
      res.json(otpResponse(channel, sent))
    } catch (err) {
      console.error('[asknelson][auth] resend failed:', err.message)
      res.status(500).json({ error: 'Could not resend the code.' })
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
      const userId = str(req.body?.userId, 64)
      const code = String(req.body?.code || '').replace(/\D/g, '')
      if (!UUID_RE.test(userId || '') || code.length !== 6) {
        return res.status(400).json({ error: 'Enter the 6-digit code.' })
      }

      const { rows } = await query("SELECT * FROM auth_users WHERE id = $1 AND status = 'pending'", [userId])
      const user = rows[0]
      if (!user) return res.status(404).json({ error: 'Nothing to verify.' })

      const result = await consumeOtp(userId, code)
      if (!result.ok) return res.status(400).json({ error: result.reason })

      if (user.is_anonymous) {
        // The promise made at sign-up, executed: the address that received the
        // PIN is erased here. Only the keyed hash survives, which is what they
        // sign in against.
        await query(
          `UPDATE auth_users
              SET status = 'active', verified_at = now(), email_enc = NULL, phone_enc = NULL
            WHERE id = $1`,
          [userId]
        )
      } else {
        // external_ref prefers the employer's own staff number; otherwise the
        // account id, so reporting still has a stable handle.
        const label = [userField(user, 'first_name'), userField(user, 'last_name')].filter(Boolean).join(' ')
        // The employer rides along so per-company reporting can group events
        // without joining back through the encrypted account tables.
        const memberId = await upsertMember(
          userField(user, 'employee_no') || `user:${userId}`,
          label || user.username,
          user.organisation_id
        )
        await query(
          "UPDATE auth_users SET status = 'active', verified_at = now(), member_id = $2 WHERE id = $1",
          [userId, memberId]
        )
        // Attribute this browser's past and future events to the new member.
        await linkDeviceFromRequest(req, memberId)
      }

      await createSession(req, res, userId, { persistent: true })
      audit(req, { actor: 'user', actorId: userId, action: 'registration_verified' })
      res.json({ user: publicUser(await loadUser(userId)) })
    } catch (err) {
      console.error('[asknelson][auth] verify failed:', err.message)
      res.status(500).json({ error: 'Could not verify that code.' })
    }
  })

  /**
   * Sign in with mobile number, email or username. Anonymous accounts have no
   * stored contact details, but their keyed hashes still resolve — so they can
   * sign in with the address they verified without us holding it.
   */
  router.post('/login', loginLimit, async (req, res) => {
    try {
      const identifier = str(req.body?.identifier, 200)
      const password = String(req.body?.password || '')
      const remember = req.body?.remember !== false
      if (!identifier || !password) {
        return res.status(400).json({ error: 'Enter your mobile number and password to sign in.' })
      }

      const { rows } = await query(
        `${USER_SELECT}
          WHERE lower(u.username) = lower($1) OR u.email_hash = $2 OR u.phone_hash = $3
          LIMIT 1`,
        [identifier, peppered(normEmail(identifier)), peppered(normPhone(identifier))]
      )
      const user = rows[0]

      // Uniform failure: never reveal whether the account exists.
      const reject = () => {
        audit(req, { actor: 'anonymous', action: 'login_failed', targetType: 'user', targetId: user?.id ?? null })
        return res.status(401).json({ error: 'Wrong mobile number or password.' })
      }

      if (!user) {
        // Burn comparable time so a missing account isn't detectable by timing.
        await hashPassword(password)
        return reject()
      }
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' })
      }
      if (user.status !== 'active') {
        return res.status(403).json({ error: 'That account is not verified yet.' })
      }

      if (!(await verifyPassword(password, user.password_hash))) {
        await query(
          `UPDATE auth_users
              SET failed_logins = failed_logins + 1,
                  locked_until = CASE WHEN failed_logins + 1 >= $2
                                      THEN now() + $3::interval
                                      ELSE locked_until END
            WHERE id = $1`,
          [user.id, MAX_FAILED_LOGINS, `${LOCKOUT_MINUTES} minutes`]
        )
        return reject()
      }

      await query(
        'UPDATE auth_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
        [user.id]
      )
      if (user.member_id) await linkDeviceFromRequest(req, user.member_id)

      await createSession(req, res, user.id, { persistent: remember })
      audit(req, { actor: 'user', actorId: user.id, action: 'login_succeeded', details: { remember } })
      res.json({ user: publicUser(user) })
    } catch (err) {
      console.error('[asknelson][auth] login failed:', err.message)
      res.status(500).json({ error: 'Could not sign you in.' })
    }
  })

  router.post('/logout', async (req, res) => {
    try {
      await endSession(req, res)
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
      res.json({ user: user ? publicUser(user) : null, otpEcho, privacyNoticeVersion: PRIVACY_NOTICE_VERSION })
    } catch {
      res.json({ user: null })
    }
  })

  router.get('/username-available', async (req, res) => {
    try {
      const username = str(req.query.username, 64)
      if (!username || username.length < 3) return res.json({ available: false })
      const { rows } = await query('SELECT 1 FROM auth_users WHERE lower(username) = lower($1)', [username])
      res.json({ available: rows.length === 0 })
    } catch {
      res.json({ available: true })
    }
  })

  // --- password reset -----------------------------------------------------------

  /**
   * Send a reset link to a mobile number or email. The link goes to the value
   * the user typed — which, since its hash matched, is the one they verified.
   * That works for anonymous accounts too, whose addresses we no longer hold.
   */
  router.post('/password/forgot', resetIpLimit, resetTargetLimit, async (req, res) => {
    try {
      const channel = req.body?.channel === 'email' ? 'email' : 'sms'
      const raw = String(req.body?.identifier || '')
      const destination = channel === 'email' ? normEmail(raw) : normPhone(raw)
      if (channel === 'email' ? !isEmail(destination) : !isPhone(destination)) {
        return res.status(400).json({
          error: channel === 'email' ? 'Enter a valid email address.' : 'Enter a valid mobile number.',
        })
      }

      const masked = maskDestination(channel, destination)
      const column = channel === 'email' ? 'email_hash' : 'phone_hash'
      const { rows } = await query(
        `SELECT id FROM auth_users WHERE ${column} = $1 AND status = 'active'`,
        [peppered(destination)]
      )
      const user = rows[0]

      if (!user) {
        if (REVEAL_UNKNOWN_ACCOUNTS) {
          return res.status(404).json({ error: 'account_not_found' })
        }
        return res.json({ ok: true, channel, destination: masked, demo: otpEcho })
      }

      const token = crypto.randomBytes(32).toString('base64url')
      await withTransaction(async (db) => {
        // Only the newest link works.
        await db.query(
          'UPDATE auth_password_resets SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL',
          [user.id]
        )
        await db.query(
          `INSERT INTO auth_password_resets (id, user_id, token_hash, channel, destination_masked, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + $6::interval)`,
          [crypto.randomUUID(), user.id, sha256(token), channel, masked, `${RESET_TTL_MINUTES} minutes`]
        )
      })
      audit(req, { actor: 'anonymous', action: 'password_reset_requested', targetType: 'user', targetId: user.id })

      const link = `${baseUrl(req)}/reset?token=${token}`
      const delivery = sendResetLink(channel, destination, link, RESET_TTL_MINUTES)
      if (otpEcho) {
        const sent = await delivery
        return res.json({ ok: true, channel, destination: masked, demo: true, devLink: sent.echo })
      }
      // Answer without waiting for the provider, so response time doesn't
      // reveal whether a message was actually sent.
      delivery.catch(() => {})
      res.json({ ok: true, channel, destination: masked, demo: false })
    } catch (err) {
      console.error('[asknelson][auth] forgot failed:', err.message)
      res.status(500).json({ error: 'Could not send a reset link.' })
    }
  })

  // Lets the reset screen say "this link has expired" up front, before the
  // user has typed a new password twice.
  router.get('/password/reset/validate', otpLimit, async (req, res) => {
    try {
      const token = String(req.query.token || '')
      if (!token) return res.json({ valid: false })
      const { rows } = await query(
        `SELECT 1 FROM auth_password_resets
          WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`,
        [sha256(token)]
      )
      res.json({ valid: rows.length > 0 })
    } catch {
      res.json({ valid: false })
    }
  })

  router.post('/password/reset', otpLimit, async (req, res) => {
    try {
      const token = String(req.body?.token || '')
      const password = String(req.body?.password || '')
      const weak = passwordProblem(password)
      if (weak) return res.status(400).json({ error: weak })
      const expired = () =>
        res.status(400).json({ error: 'This reset link has expired or was already used. Request a new one.' })
      if (!token) return expired()

      const passwordHash = await hashPassword(password)
      const userId = await withTransaction(async (db) => {
        const { rows } = await db.query(
          `SELECT user_id FROM auth_password_resets
            WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
            FOR UPDATE`,
          [sha256(token)]
        )
        if (!rows[0]) return null
        const id = rows[0].user_id
        await db.query(
          `UPDATE auth_users
              SET password_hash = $2, password_changed_at = now(), failed_logins = 0, locked_until = NULL
            WHERE id = $1`,
          [id, passwordHash]
        )
        await db.query(
          'UPDATE auth_password_resets SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL',
          [id]
        )
        // Whoever knew the old password is signed out everywhere.
        await db.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id])
        return id
      })
      if (!userId) return expired()

      audit(req, { actor: 'user', actorId: userId, action: 'password_reset_completed' })
      res.json({ ok: true })
    } catch (err) {
      console.error('[asknelson][auth] reset failed:', err.message)
      res.status(500).json({ error: 'Could not reset your password.' })
    }
  })

  // --- POPIA data-subject rights ------------------------------------------------

  /** s23 right of access: everything held about the signed-in user, decrypted. */
  router.get('/me/export', requireUser, sensitiveLimit, async (req, res) => {
    try {
      const user = req.user
      const [consents, sessions, progress, activity] = await Promise.all([
        query(
          `SELECT purpose, notice_version, granted, source, recorded_at
             FROM user_consents WHERE user_id = $1 ORDER BY recorded_at`,
          [user.id]
        ),
        query(
          `SELECT created_at, last_seen_at, expires_at, revoked_at, persistent
             FROM auth_sessions WHERE user_id = $1 ORDER BY created_at DESC`,
          [user.id]
        ),
        progressSnapshot(user.id),
        user.member_id ? memberActivity(user.member_id) : [],
      ])
      audit(req, { actor: 'user', actorId: user.id, action: 'data_exported' })
      res.set('Content-Disposition', 'attachment; filename="asknelson-my-data.json"')
      res.json({
        exportedAt: new Date().toISOString(),
        privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
        account: publicUser(user),
        consents: consents.rows,
        sessions: sessions.rows,
        progress,
        activity,
        notes: user.is_anonymous
          ? 'Your account is anonymous: app activity is never linked to it, so none can be listed here.'
          : 'Your ID number is not included because it was never stored — only a one-way fingerprint of it.',
      })
    } catch (err) {
      console.error('[asknelson][auth] export failed:', err.message)
      res.status(500).json({ error: 'Could not export your data.' })
    }
  })

  /**
   * s24 right to deletion. Removes the account, its progress and consents,
   * and every analytics row tied to it or to this browser. The audit trail
   * keeps only that an account id was deleted.
   */
  router.post('/me/delete', requireUser, sensitiveLimit, async (req, res) => {
    try {
      const user = req.user
      if (!(await verifyPassword(String(req.body?.password || ''), user.password_hash))) {
        return res.status(401).json({ error: 'That password is not right.' })
      }
      const deviceId = readCookie(req, DEVICE_COOKIE)
      await withTransaction(async (db) => {
        if (user.member_id) {
          // Devices cascade to their sessions and events.
          await db.query('DELETE FROM analytics_devices WHERE member_id = $1', [user.member_id])
          await db.query('DELETE FROM analytics_members WHERE id = $1', [user.member_id])
        }
        if (UUID_RE.test(deviceId || '')) {
          await db.query('DELETE FROM analytics_devices WHERE id = $1', [deviceId])
        }
        // Cascades to sessions, codes, reset links, consents and all progress.
        await db.query('DELETE FROM auth_users WHERE id = $1', [user.id])
      })
      audit(req, { actor: 'user', actorId: user.id, action: 'account_deleted' })
      res.clearCookie(SESSION_COOKIE, { path: '/' })
      res.clearCookie(DEVICE_COOKIE, { path: '/' })
      res.json({ ok: true })
    } catch (err) {
      console.error('[asknelson][auth] delete failed:', err.message)
      res.status(500).json({ error: 'Could not delete your account.' })
    }
  })

  return router
}

/** Delete expired sessions, codes, reset links and stale pending sign-ups. */
export function startAuthSweeper(intervalMinutes = 60) {
  if (!isEnabled) return null
  const timer = setInterval(
    () => {
      query("DELETE FROM auth_sessions WHERE expires_at < now() - interval '7 days'").catch(() => {})
      query("DELETE FROM auth_otp_codes WHERE created_at < now() - interval '1 day'").catch(() => {})
      query("DELETE FROM auth_password_resets WHERE created_at < now() - interval '1 day'").catch(() => {})
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
