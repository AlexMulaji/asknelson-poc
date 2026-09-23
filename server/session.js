import crypto from 'node:crypto'
import { query } from './db.js'
import { aad, seal } from './crypto.js'
import { isSecure, readCookie, str } from './http.js'

// Server-side sessions. The cookie carries a random token; only its SHA-256
// lives in auth_sessions, so a stolen database cannot be used to mint a valid
// cookie.

export const SESSION_COOKIE = 'an_auth'
const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS || 30)
// "Remember me" unticked: a browser-session cookie, and a short server-side
// lifetime so a forgotten shared computer doesn't stay signed in for a month.
const SHORT_SESSION_HOURS = Number(process.env.AUTH_SHORT_SESSION_HOURS || 12)
// Applies to every session regardless of "remember me" — a browser-session
// cookie isn't reliably dropped on close (installed/mobile PWAs keep it
// alive), so this is the real backstop against staying signed in forever.
const IDLE_TIMEOUT_MINUTES = Number(process.env.AUTH_IDLE_TIMEOUT_MINUTES || 120)

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')

// Every user load joins the employer, so callers always have its name.
export const USER_SELECT = `
  SELECT u.*, o.name AS organisation_name
    FROM auth_users u
    LEFT JOIN organisations o ON o.id = u.organisation_id`

export async function createSession(req, res, userId, { persistent = true } = {}) {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = sha256(token)
  await query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at, persistent, user_agent_enc)
     VALUES ($1, $2, now() + $3::interval, $4, $5)`,
    [
      tokenHash,
      userId,
      persistent ? `${SESSION_DAYS} days` : `${SHORT_SESSION_HOURS} hours`,
      persistent,
      seal(str(req.get('user-agent'), 512), aad('auth_sessions', 'user_agent', tokenHash)),
    ]
  )
  // httpOnly: the token must be unreachable from JavaScript, so an XSS bug
  // cannot exfiltrate a logged-in session. No maxAge when not persistent, so
  // the browser drops it on close.
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    path: '/',
    ...(persistent ? { maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 } : {}),
  })
}

export async function currentUser(req) {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) return null
  const tokenHash = sha256(token)
  const { rows } = await query(
    `SELECT u.*, o.name AS organisation_name
       FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
       LEFT JOIN organisations o ON o.id = u.organisation_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND s.last_seen_at > now() - ($2 * interval '1 minute')
        AND u.status = 'active'`,
    [tokenHash, IDLE_TIMEOUT_MINUTES]
  )
  if (!rows[0]) return null
  // Rolling expiry: an active user stays signed in. Throttled to one write per
  // five minutes, since every progress call passes through here.
  query(
    `UPDATE auth_sessions
        SET last_seen_at = now(),
            expires_at = now() + CASE WHEN persistent THEN $2::interval ELSE $3::interval END
      WHERE token_hash = $1 AND last_seen_at < now() - interval '5 minutes'`,
    [tokenHash, `${SESSION_DAYS} days`, `${SHORT_SESSION_HOURS} hours`]
  ).catch(() => {})
  return rows[0]
}

/** Express guard for routes that require a signed-in user; sets req.user. */
export function requireUser(req, res, next) {
  currentUser(req)
    .then((user) => {
      if (!user) return res.status(401).json({ error: 'Not signed in' })
      req.user = user
      next()
    })
    .catch(() => res.status(500).json({ error: 'Session check failed' }))
}

export async function endSession(req, res) {
  const token = readCookie(req, SESSION_COOKIE)
  if (token) {
    await query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1', [sha256(token)])
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}
