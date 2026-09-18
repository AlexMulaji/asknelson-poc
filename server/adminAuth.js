import express from 'express'
import crypto from 'node:crypto'
import { blindIndex } from './crypto.js'
import { hashPassword, passwordProblem, verifyPassword } from './passwords.js'
import { isSecure, noStore, rateLimiter, readCookie } from './http.js'
import { PERMISSIONS, ROLE_LABELS, ROLE_NAMES, canManage, isRole, permissionsFor } from './rbac.js'
import {
  PERIOD_SECONDS,
  formatSecret,
  generateSecret,
  otpauthUri,
  totp,
  verifyTotp,
} from './totp.js'

// Admin sign-in: named accounts, a password, and a second factor that is not
// optional.
//
// What this replaces: one ADMIN_PASSWORD, shared by everyone who needed the
// portal, kept in the browser's sessionStorage and sent as a bearer token on
// every request. Anyone holding it could edit content, publish it, export the
// event stream and decrypt a member's browsing history, and the audit trail
// could only ever say "admin". For a system holding health information that is
// not defensible.
//
// The flow is two steps, and the cookie exists between them:
//
//   POST /login  password checked -> a session cookie with mfa_verified = false.
//                That session can do exactly two things: enrol a second factor,
//                or present one. Every other admin route refuses it (see
//                requirePermission in rbac.js).
//   POST /mfa    a TOTP code or a recovery code -> mfa_verified = true.
//
// Holding the half-finished session in a cookie, rather than handing the
// client a "pending login" token, means a stolen first factor is useless
// without the browser that started the sign-in.

export const ADMIN_COOKIE = 'an_admin'

const SESSION_HOURS = Number(process.env.ADMIN_SESSION_HOURS || 12)
// The window between password and second factor. Short: nothing useful can be
// done with a half-finished session, and it should not outlive a coffee break.
const PENDING_MINUTES = Number(process.env.ADMIN_MFA_WINDOW_MINUTES || 10)
const MAX_FAILED_LOGINS = Number(process.env.ADMIN_MAX_FAILED_LOGINS || 5)
const LOCKOUT_MINUTES = Number(process.env.ADMIN_LOCKOUT_MINUTES || 15)
const RECOVERY_CODE_COUNT = 10

// Demo mode, mirroring OTP_ECHO for member sign-up: the current authenticator
// code is handed back by the API and shown on screen, so the portal can be set
// up and demonstrated on a machine with no authenticator app to hand.
//
// Be clear about what this costs: it defeats two-factor authentication
// entirely. Anyone who reaches the password screen is then handed the second
// factor, which makes it one factor with extra steps. Hence: off unless
// explicitly switched on, never applied to a request that has not already
// passed the password, and it announces itself loudly at boot.
const MFA_ECHO = process.env.ADMIN_MFA_ECHO === 'true'

if (MFA_ECHO) {
  console.warn(
    '\n' +
      '  ┌──────────────────────────────────────────────────────────────┐\n' +
      '  │  ADMIN 2FA DEMO MODE IS ON                                   │\n' +
      '  │                                                              │\n' +
      '  │  The current authenticator code is returned by the API and   │\n' +
      '  │  shown in the browser. Anyone holding an admin password can  │\n' +
      '  │  sign in with no second factor at all. Unset ADMIN_MFA_ECHO  │\n' +
      '  │  before real admins arrive.                                  │\n' +
      '  └──────────────────────────────────────────────────────────────┘\n'
  )
}

/** The code an authenticator app would be showing, and how long it lasts. */
function echoFor(secret, now) {
  if (!MFA_ECHO || !secret) return null
  const elapsed = Math.floor(now().getTime() / 1000) % PERIOD_SECONDS
  return {
    code: totp(secret, { timeMs: now().getTime() }),
    expiresInSeconds: PERIOD_SECONDS - elapsed,
  }
}

export const adminMfaEcho = MFA_ECHO

// Deliberately not the full alphabet: no 0/O or 1/I/L, because these are read
// off a printout and typed by someone who has just lost their phone.
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
const recoveryHash = (code) => blindIndex(normaliseRecoveryCode(code), 'admin-recovery')

export function normaliseRecoveryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function generateRecoveryCode() {
  const pick = () => RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]
  const block = () => Array.from({ length: 5 }, pick).join('')
  return `${block()}-${block()}`
}

/** The admin as the client sees it — never a hash, never the TOTP secret. */
export function publicAdmin(admin, { mfaVerified = true } = {}) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    roleLabel: ROLE_LABELS[admin.role] ?? admin.role,
    status: admin.status,
    // The client hides controls it has no permission for. The server enforces
    // the same list independently — this is for the UI, never for access.
    permissions: mfaVerified ? permissionsFor(admin.role) : [],
    mfaEnrolled: Boolean(admin.totpEnrolledAt),
    mfaVerified,
    lastLoginAt: admin.lastLoginAt ?? null,
    createdAt: admin.createdAt ?? null,
  }
}

/**
 * Resolves the admin session cookie onto `req.admin`, or leaves it undefined.
 * Never rejects a request itself — requirePermission decides what an
 * unauthenticated or half-authenticated request is allowed to do.
 */
export function createAdminSessionMiddleware({ store, now = () => new Date() }) {
  return (req, _res, next) => {
    const token = readCookie(req, ADMIN_COOKIE)
    if (!token) return next()

    const tokenHash = sha256(token)
    store
      .findSession(tokenHash)
      .then(async (session) => {
        if (!session || session.revokedAt) return
        if (new Date(session.expiresAt) < now()) return
        const admin = await store.findAdminById(session.adminId)
        if (!admin || admin.status !== 'active') return
        req.admin = {
          ...admin,
          mfaVerified: Boolean(session.mfaVerified),
          sessionTokenHash: tokenHash,
        }
        // Rolling expiry, throttled to one write every five minutes — every
        // admin request passes through here.
        const idleMs = now() - new Date(session.lastSeenAt ?? session.createdAt ?? now())
        if (session.mfaVerified && idleMs > 5 * 60_000) {
          await store
            .updateSession(tokenHash, {
              lastSeenAt: now().toISOString(),
              expiresAt: new Date(now().getTime() + SESSION_HOURS * 3600_000).toISOString(),
            })
            .catch(() => {})
        }
      })
      .catch((err) => {
        console.error('[asknelson][admin] session lookup failed:', err.message)
      })
      .finally(next)
  }
}

/**
 * Create the first owner when there are no admins at all, from
 * ADMIN_BOOTSTRAP_EMAIL + ADMIN_PASSWORD.
 *
 * Only ever runs against an empty store, so it cannot be used to re-take an
 * existing installation by setting an environment variable. The account is
 * created without a second factor, which the first sign-in is then forced to
 * enrol before it can do anything.
 *
 * @returns {{created:boolean, email?:string, reason?:string}}
 */
export async function ensureBootstrapAdmin(store, { email, password } = {}) {
  if ((await store.countAdmins()) > 0) return { created: false, reason: 'admins-exist' }
  if (!email || !password) return { created: false, reason: 'not-configured' }
  const weak = passwordProblem(password)
  if (weak) return { created: false, reason: weak }

  await store.createAdmin({
    email,
    name: 'Owner',
    role: 'owner',
    status: 'active',
    passwordHash: await hashPassword(password),
  })
  return { created: true, email }
}

export function createAdminAuthRouter({ store, audit = () => {}, now = () => new Date() }) {
  const router = express.Router()
  router.use(express.json({ limit: '64kb' }))
  router.use(noStore)

  // Per-IP, because an admin email is not something an attacker has to guess.
  const loginLimit = rateLimiter({
    windowMs: 15 * 60_000,
    max: 20,
    message: 'Too many sign-in attempts. Please wait and try again.',
  })
  // Tighter: 6 digits is a small space, and the account lockout below does not
  // apply to the second factor (it is already past the password).
  const mfaLimit = rateLimiter({
    windowMs: 15 * 60_000,
    max: 10,
    message: 'Too many codes tried. Please wait and try again.',
  })

  const setSessionCookie = (req, res, token, maxAgeMs) => {
    res.cookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: isSecure(req),
      path: '/',
      maxAge: maxAgeMs,
    })
  }

  async function startSession(req, res, admin, { mfaVerified }) {
    const token = crypto.randomBytes(32).toString('base64url')
    const lifetimeMs = mfaVerified ? SESSION_HOURS * 3600_000 : PENDING_MINUTES * 60_000
    await store.createSession({
      tokenHash: sha256(token),
      adminId: admin.id,
      mfaVerified,
      createdAt: now().toISOString(),
      lastSeenAt: now().toISOString(),
      expiresAt: new Date(now().getTime() + lifetimeMs).toISOString(),
      revokedAt: null,
      userAgent: req.get('user-agent') ?? null,
    })
    setSessionCookie(req, res, token, lifetimeMs)
    return token
  }

  /** Promote the half-finished session in the cookie to a full one. */
  async function completeMfa(req, res) {
    const tokenHash = req.admin.sessionTokenHash
    await store.updateSession(tokenHash, {
      mfaVerified: true,
      lastSeenAt: now().toISOString(),
      expiresAt: new Date(now().getTime() + SESSION_HOURS * 3600_000).toISOString(),
    })
    // The browser holds the same token; only its server-side lifetime grows,
    // so refresh the cookie's max-age to match.
    const token = readCookie(req, ADMIN_COOKIE)
    if (token) setSessionCookie(req, res, token, SESSION_HOURS * 3600_000)
    await store.updateAdmin(req.admin.id, {
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: now().toISOString(),
    })
  }

  // --- sign in ----------------------------------------------------------------

  router.post('/login', loginLimit, async (req, res) => {
    try {
      const email = String(req.body?.email ?? '').trim()
      const password = String(req.body?.password ?? '')
      if (!email || !password) {
        return res.status(400).json({ error: 'Enter your email address and password.' })
      }

      const admin = await store.findAdminByEmail(email)
      // Same message and a comparable amount of work either way: whether an
      // address is an admin here is itself worth not confirming.
      const failed = { error: 'Those details are not right.' }
      if (!admin || admin.status !== 'active') {
        await hashPassword(password).catch(() => {})
        audit(req, { actor: 'admin', action: 'admin_login_failed', details: { reason: 'unknown-or-disabled' } })
        return res.status(401).json(failed)
      }

      if (admin.lockedUntil && new Date(admin.lockedUntil) > now()) {
        return res.status(423).json({
          error: 'That account is temporarily locked after too many failed attempts.',
          lockedUntil: admin.lockedUntil,
        })
      }

      if (!(await verifyPassword(password, admin.passwordHash))) {
        const failures = (admin.failedLogins ?? 0) + 1
        await store.updateAdmin(admin.id, {
          failedLogins: failures,
          lockedUntil:
            failures >= MAX_FAILED_LOGINS
              ? new Date(now().getTime() + LOCKOUT_MINUTES * 60_000).toISOString()
              : admin.lockedUntil ?? null,
        })
        audit(req, {
          actor: 'admin',
          actorId: admin.id,
          action: 'admin_login_failed',
          details: { reason: 'bad-password', failures },
        })
        return res.status(401).json(failed)
      }

      // Password accepted — but this session cannot do anything yet.
      await startSession(req, res, admin, { mfaVerified: false })
      const enrolled = Boolean(admin.totpEnrolledAt)
      audit(req, {
        actor: 'admin',
        actorId: admin.id,
        action: enrolled ? 'admin_password_accepted' : 'admin_login_needs_enrolment',
      })
      res.json({
        status: enrolled ? 'mfa_required' : 'enrolment_required',
        admin: publicAdmin(admin, { mfaVerified: false }),
      })
    } catch (err) {
      console.error('[asknelson][admin] login failed:', err.message)
      res.status(500).json({ error: 'Could not sign you in.' })
    }
  })

  /** Every route below needs at least the half-finished session. */
  const requireSession = (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Not signed in' })
    next()
  }

  const requireFullSession = (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Not signed in' })
    if (!req.admin.mfaVerified) {
      return res.status(401).json({ error: 'Two-factor authentication required', mfaRequired: true })
    }
    next()
  }

  // --- second factor ------------------------------------------------------------

  /**
   * Begin enrolment: mint a secret and hand back what an authenticator app
   * needs. It is stored immediately but marked unenrolled (totpEnrolledAt is
   * null), so an abandoned setup leaves an account that still cannot sign in
   * rather than one locked out of a secret nobody scanned.
   */
  router.post('/totp/setup', requireSession, async (req, res) => {
    try {
      if (req.admin.totpEnrolledAt && !req.admin.mfaVerified) {
        // Already enrolled and not yet past the second factor: re-enrolling
        // here would be a way around it.
        return res.status(409).json({ error: 'This account already has two-factor authentication.' })
      }
      const secret = generateSecret()
      await store.updateAdmin(req.admin.id, { totpSecret: secret, totpEnrolledAt: null, totpLastCounter: null })
      audit(req, { actor: 'admin', actorId: req.admin.id, action: 'admin_totp_setup_started' })
      res.json({
        secret,
        // Grouped for anyone typing it in by hand instead of scanning.
        secretFormatted: formatSecret(secret),
        otpauthUri: otpauthUri({ secret, account: req.admin.email ?? req.admin.id }),
        // Null unless ADMIN_MFA_ECHO is on, and only ever for the account that
        // is enrolling right now.
        echo: echoFor(secret, now),
      })
    } catch (err) {
      console.error('[asknelson][admin] totp setup failed:', err.message)
      res.status(500).json({ error: 'Could not start enrolment.' })
    }
  })

  /** Finish enrolment by proving the app holds the secret. */
  router.post('/totp/enrol', requireSession, mfaLimit, async (req, res) => {
    try {
      const admin = await store.findAdminById(req.admin.id)
      if (!admin?.totpSecret) {
        return res.status(409).json({ error: 'Start enrolment first.' })
      }
      if (admin.totpEnrolledAt && !req.admin.mfaVerified) {
        return res.status(409).json({ error: 'This account already has two-factor authentication.' })
      }
      const result = verifyTotp(admin.totpSecret, req.body?.code, { timeMs: now().getTime() })
      if (!result.ok) {
        return res.status(401).json({ error: 'That code is not right. Check the time on your phone and try again.' })
      }

      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
      await store.replaceRecoveryCodes(admin.id, codes.map(recoveryHash))
      await store.updateAdmin(admin.id, {
        totpEnrolledAt: now().toISOString(),
        totpLastCounter: result.counter,
      })
      await completeMfa(req, res)

      audit(req, { actor: 'admin', actorId: admin.id, action: 'admin_totp_enrolled' })
      res.json({
        ok: true,
        // Shown exactly once. Only their hashes are stored, so this response is
        // the only opportunity to write them down.
        recoveryCodes: codes,
        admin: publicAdmin({ ...admin, totpEnrolledAt: now().toISOString() }),
      })
    } catch (err) {
      console.error('[asknelson][admin] totp enrol failed:', err.message)
      res.status(500).json({ error: 'Could not complete enrolment.' })
    }
  })

  /**
   * The code an authenticator app would be showing right now — demo mode only.
   *
   * Sits behind requireSession, so it is reachable only by someone who has
   * already passed the password for that exact account: it can reveal a code,
   * never whose code it is. A 404 when the flag is off, so a probe cannot tell
   * demo mode from a build that never had it.
   */
  router.get('/totp/echo', requireSession, async (req, res) => {
    if (!MFA_ECHO) return res.status(404).json({ error: 'Not found' })
    const admin = await store.findAdminById(req.admin.id)
    const echo = echoFor(admin?.totpSecret, now)
    if (!echo) return res.status(409).json({ error: 'No second factor is set up yet.' })
    res.json(echo)
  })

  /** Present the second factor: an authenticator code, or a recovery code. */
  router.post('/mfa', requireSession, mfaLimit, async (req, res) => {
    try {
      const admin = await store.findAdminById(req.admin.id)
      if (!admin?.totpEnrolledAt) {
        return res.status(409).json({ error: 'This account has no second factor yet.', enrolmentRequired: true })
      }
      if (req.admin.mfaVerified) return res.json({ ok: true, admin: publicAdmin(admin) })

      const submitted = String(req.body?.code ?? '')
      const result = verifyTotp(admin.totpSecret, submitted, {
        timeMs: now().getTime(),
        // Refuses a code already used, so one shoulder-surfed as it was typed
        // cannot be replayed within its 30-second step.
        lastCounter: admin.totpLastCounter,
      })

      if (result.ok) {
        await store.updateAdmin(admin.id, { totpLastCounter: result.counter })
        await completeMfa(req, res)
        audit(req, { actor: 'admin', actorId: admin.id, action: 'admin_signed_in', details: { factor: 'totp' } })
        return res.json({ ok: true, admin: publicAdmin(admin) })
      }

      // Recovery codes are longer than 6 digits, so trying one costs nothing
      // when the submission was clearly meant to be a TOTP code.
      const normalised = normaliseRecoveryCode(submitted)
      if (normalised.length >= 8 && (await store.consumeRecoveryCode(admin.id, recoveryHash(submitted)))) {
        await completeMfa(req, res)
        const remaining = await store.countRecoveryCodes(admin.id)
        audit(req, {
          actor: 'admin',
          actorId: admin.id,
          action: 'admin_signed_in',
          details: { factor: 'recovery-code', remaining },
        })
        return res.json({ ok: true, admin: publicAdmin(admin), recoveryCodesRemaining: remaining })
      }

      audit(req, { actor: 'admin', actorId: admin.id, action: 'admin_mfa_failed' })
      res.status(401).json({ error: 'That code is not right.' })
    } catch (err) {
      console.error('[asknelson][admin] mfa failed:', err.message)
      res.status(500).json({ error: 'Could not check that code.' })
    }
  })

  // --- session ------------------------------------------------------------------

  router.get('/me', async (req, res) => {
    if (!req.admin) return res.status(401).json({ error: 'Not signed in' })
    const admin = await store.findAdminById(req.admin.id)
    if (!admin) return res.status(401).json({ error: 'Not signed in' })
    res.json({
      admin: publicAdmin(admin, { mfaVerified: req.admin.mfaVerified }),
      status: req.admin.mfaVerified
        ? 'signed_in'
        : admin.totpEnrolledAt
          ? 'mfa_required'
          : 'enrolment_required',
      recoveryCodesRemaining: req.admin.mfaVerified ? await store.countRecoveryCodes(admin.id) : null,
      // Lets the sign-in screen offer the code rather than demanding an app.
      mfaEcho: MFA_ECHO,
    })
  })

  router.post('/logout', async (req, res) => {
    if (req.admin) {
      await store.updateSession(req.admin.sessionTokenHash, { revokedAt: now().toISOString() })
      audit(req, { actor: 'admin', actorId: req.admin.id, action: 'admin_signed_out' })
    }
    res.clearCookie(ADMIN_COOKIE, { path: '/' })
    res.json({ ok: true })
  })

  /** Change your own password. Signs every other session of yours out. */
  router.post('/password', requireFullSession, async (req, res) => {
    try {
      const admin = await store.findAdminById(req.admin.id)
      const current = String(req.body?.currentPassword ?? '')
      const next = String(req.body?.newPassword ?? '')
      if (!(await verifyPassword(current, admin.passwordHash))) {
        return res.status(401).json({ error: 'Your current password is not right.' })
      }
      const weak = passwordProblem(next)
      if (weak) return res.status(400).json({ error: weak })

      await store.updateAdmin(admin.id, {
        passwordHash: await hashPassword(next),
        passwordChangedAt: now().toISOString(),
      })
      // Anyone who had a session on the old password loses it; this one stays,
      // so changing a password does not sign you out of the tab you are in.
      await store.revokeSessionsFor(admin.id, { except: req.admin.sessionTokenHash })
      audit(req, { actor: 'admin', actorId: admin.id, action: 'admin_password_changed' })
      res.json({ ok: true })
    } catch (err) {
      console.error('[asknelson][admin] password change failed:', err.message)
      res.status(500).json({ error: 'Could not change your password.' })
    }
  })

  /** Replace your recovery codes — the old ones stop working immediately. */
  router.post('/recovery-codes', requireFullSession, async (req, res) => {
    try {
      const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode)
      await store.replaceRecoveryCodes(req.admin.id, codes.map(recoveryHash))
      audit(req, { actor: 'admin', actorId: req.admin.id, action: 'admin_recovery_codes_regenerated' })
      res.json({ recoveryCodes: codes })
    } catch (err) {
      console.error('[asknelson][admin] recovery codes failed:', err.message)
      res.status(500).json({ error: 'Could not generate new codes.' })
    }
  })

  return router
}

// --- admin account management ----------------------------------------------------

/**
 * CRUD over admin accounts, gated on admin:manage. Mounted separately from the
 * sign-in routes because everything here needs a fully authenticated session,
 * and because it is the one place where privilege can be handed out.
 */
export function createAdminUsersRouter({ store, audit = () => {}, now = () => new Date() }) {
  const router = express.Router()
  router.use(express.json({ limit: '64kb' }))
  router.use(noStore)

  const guard = (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'Not signed in' })
    if (!req.admin.mfaVerified) {
      return res.status(401).json({ error: 'Two-factor authentication required', mfaRequired: true })
    }
    const verdict = canManage(req.admin, null, {})
    if (!verdict.ok) return res.status(403).json({ error: verdict.reason })
    next()
  }

  /**
   * An installation must always have someone who can grant roles back. Checked
   * before any demotion, disabling or deletion of an owner.
   */
  async function wouldOrphan(targetId, changes) {
    const admins = await store.listAdmins()
    const activeOwners = admins.filter((a) => a.role === 'owner' && a.status === 'active')
    if (!activeOwners.some((a) => a.id === targetId)) return false
    const stillOwner = (changes.role ?? 'owner') === 'owner' && (changes.status ?? 'active') === 'active'
    return activeOwners.length === 1 && !stillOwner
  }

  router.get('/', guard, async (_req, res) => {
    const admins = await store.listAdmins()
    res.json({
      admins: admins.map((a) => publicAdmin(a)),
      roles: ROLE_NAMES.map((name) => ({ name, label: ROLE_LABELS[name], permissions: permissionsFor(name) })),
    })
  })

  router.post('/', guard, async (req, res) => {
    try {
      const email = String(req.body?.email ?? '').trim()
      const role = String(req.body?.role ?? '')
      const password = String(req.body?.password ?? '')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'That email address looks wrong.' })
      }
      if (!isRole(role)) return res.status(400).json({ error: `Unknown role "${role}".` })
      const verdict = canManage(req.admin, null, { role })
      if (!verdict.ok) return res.status(403).json({ error: verdict.reason })
      const weak = passwordProblem(password)
      if (weak) return res.status(400).json({ error: weak })

      const admin = await store.createAdmin({
        email,
        name: req.body?.name ? String(req.body.name).slice(0, 120) : null,
        role,
        status: 'active',
        passwordHash: await hashPassword(password),
      })
      audit(req, {
        actor: 'admin',
        actorId: req.admin.id,
        action: 'admin_account_created',
        targetType: 'admin',
        targetId: admin.id,
        details: { role },
      })
      // They have no second factor yet, so their first sign-in must enrol one.
      res.status(201).json({ admin: publicAdmin(admin) })
    } catch (err) {
      if (err.code === 'DUPLICATE') return res.status(409).json({ error: err.message })
      console.error('[asknelson][admin] create admin failed:', err.message)
      res.status(500).json({ error: 'Could not create that account.' })
    }
  })

  router.patch('/:id', guard, async (req, res) => {
    try {
      const target = await store.findAdminById(req.params.id)
      if (!target) return res.status(404).json({ error: 'No such admin account.' })

      const changes = {}
      if ('name' in req.body) changes.name = req.body.name ? String(req.body.name).slice(0, 120) : null
      if ('role' in req.body) changes.role = String(req.body.role)
      if ('status' in req.body) changes.status = String(req.body.status)

      const verdict = canManage(req.admin, target, changes)
      if (!verdict.ok) return res.status(403).json({ error: verdict.reason })
      if (changes.status && !['active', 'disabled'].includes(changes.status)) {
        return res.status(400).json({ error: 'Status must be active or disabled.' })
      }
      if (await wouldOrphan(target.id, changes)) {
        return res.status(409).json({ error: 'That would leave the portal with no active owner.' })
      }

      if (req.body?.password != null) {
        const weak = passwordProblem(String(req.body.password))
        if (weak) return res.status(400).json({ error: weak })
        changes.passwordHash = await hashPassword(String(req.body.password))
        changes.passwordChangedAt = now().toISOString()
      }

      const updated = await store.updateAdmin(target.id, changes)
      // A demotion, a disabling or a new password must take effect now, not
      // whenever their current session happens to expire.
      if (changes.role || changes.status || changes.passwordHash) {
        await store.revokeSessionsFor(target.id)
      }
      audit(req, {
        actor: 'admin',
        actorId: req.admin.id,
        action: 'admin_account_updated',
        targetType: 'admin',
        targetId: target.id,
        details: { role: changes.role, status: changes.status, passwordReset: Boolean(changes.passwordHash) },
      })
      res.json({ admin: publicAdmin(updated) })
    } catch (err) {
      console.error('[asknelson][admin] update admin failed:', err.message)
      res.status(500).json({ error: 'Could not update that account.' })
    }
  })

  /**
   * Clear someone's second factor so they can enrol a new one — the lost-phone
   * path, for when their recovery codes are gone too. Their sessions end with
   * it, so this cannot be used to walk into an already-open portal.
   */
  router.post('/:id/reset-mfa', guard, async (req, res) => {
    const target = await store.findAdminById(req.params.id)
    if (!target) return res.status(404).json({ error: 'No such admin account.' })
    const verdict = canManage(req.admin, target, {})
    if (!verdict.ok) return res.status(403).json({ error: verdict.reason })

    await store.updateAdmin(target.id, { totpSecret: null, totpEnrolledAt: null, totpLastCounter: null })
    await store.replaceRecoveryCodes(target.id, [])
    await store.revokeSessionsFor(target.id)
    audit(req, {
      actor: 'admin',
      actorId: req.admin.id,
      action: 'admin_mfa_reset',
      targetType: 'admin',
      targetId: target.id,
    })
    res.json({ ok: true })
  })

  router.delete('/:id', guard, async (req, res) => {
    const target = await store.findAdminById(req.params.id)
    if (!target) return res.status(404).json({ error: 'No such admin account.' })
    if (target.id === req.admin.id) {
      return res.status(403).json({ error: 'You cannot delete your own account.' })
    }
    const verdict = canManage(req.admin, target, {})
    if (!verdict.ok) return res.status(403).json({ error: verdict.reason })
    if (await wouldOrphan(target.id, { status: 'deleted' })) {
      return res.status(409).json({ error: 'That would leave the portal with no active owner.' })
    }

    await store.deleteAdmin(target.id)
    audit(req, {
      actor: 'admin',
      actorId: req.admin.id,
      action: 'admin_account_deleted',
      targetType: 'admin',
      targetId: target.id,
    })
    res.json({ ok: true })
  })

  return router
}

export { PERMISSIONS }
