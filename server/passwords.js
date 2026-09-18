import crypto from 'node:crypto'
import { promisify } from 'node:util'

// Password hashing, shared by member accounts (auth.js) and admin accounts
// (adminAuth.js) so there is exactly one implementation to get right.
//
// scrypt from node:crypto rather than argon2/bcrypt: both of those are native
// addons that complicate the Alpine build for no security gain here. Params
// follow the OWASP scrypt guidance (N=2^15, r=8, p=1).

const scrypt = promisify(crypto.scrypt)

export const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 }
const MAXMEM = 256 * 1024 * 1024

// Hashing is deliberately slow, so an unbounded password is a free way to tie
// up the event loop. 1024 is far beyond any real passphrase.
const MAX_PASSWORD_BYTES = 1024

export const MIN_PASSWORD = Number(process.env.AUTH_MIN_PASSWORD || 8)

export async function hashPassword(password, params = SCRYPT) {
  const value = String(password)
  if (Buffer.byteLength(value) > MAX_PASSWORD_BYTES) throw new Error('Password is too long')
  const salt = crypto.randomBytes(16)
  const key = await scrypt(value, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: MAXMEM,
  })
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

/** Never throws: an unparseable or missing hash is simply a failed check. */
export async function verifyPassword(password, stored) {
  try {
    const value = String(password)
    if (Buffer.byteLength(value) > MAX_PASSWORD_BYTES) return false
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(keyB64, 'base64')
    if (salt.length === 0 || expected.length === 0) return false
    const actual = await scrypt(value, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    })
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/**
 * Why a password is unacceptable, or null when it is fine.
 *
 * Length only, plus a check against the handful of passwords every credential
 * stuffing list starts with. NIST SP 800-63B deliberately drops composition
 * rules ("must contain a symbol"): they push people towards P@ssw0rd1 and buy
 * nothing against an attacker with a rule engine.
 */
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'admin123', 'letmein1', 'welcome1', 'iloveyou', 'asknelson',
])

export function passwordProblem(password, { min = MIN_PASSWORD } = {}) {
  const value = String(password ?? '')
  if (value.length < min) return `Password must be at least ${min} characters.`
  if (Buffer.byteLength(value) > MAX_PASSWORD_BYTES) return 'That password is too long.'
  if (COMMON.has(value.toLowerCase())) return 'That password is too easy to guess. Choose another.'
  return null
}
