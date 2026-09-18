import crypto from 'node:crypto'

// Time-based one-time passwords (RFC 6238) for admin two-factor auth.
//
// Implemented on node:crypto rather than pulled from npm: it is ~60 lines of
// HMAC, it must keep working for as long as the admins' authenticator apps do,
// and a second factor is the last thing that should depend on a transitive
// dependency nobody has read.
//
// Defaults match what Google Authenticator, 1Password, Authy and Microsoft
// Authenticator all assume when a QR code omits them: SHA-1, 6 digits, 30s.
// SHA-1 here is not a collision concern — HMAC-SHA1 is unbroken, and the
// alternatives are not universally supported by authenticator apps.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const DIGITS = 6
export const PERIOD_SECONDS = 30
// One step either side of now, so a code entered as it rolls over, or from a
// phone whose clock is half a minute out, still works. Wider than this starts
// meaningfully extending the window an intercepted code stays usable.
export const DEFAULT_WINDOW = 1

/** RFC 4648 base32, unpadded — the encoding every authenticator app expects. */
export function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Decode base32, tolerating the spaces and padding people paste in. */
export function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const out = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base32 character in secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A fresh 160-bit secret, base32 encoded — the size RFC 4226 recommends. */
export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes))
}

/** Group a secret into fours so it can be typed in by hand without losing place. */
export function formatSecret(secret) {
  return String(secret).replace(/(.{4})(?=.)/g, '$1 ')
}

/**
 * The counter for a moment in time. Exposed because replay protection stores
 * the last accepted counter rather than the code itself — see verifyTotp.
 */
export function counterAt(timeMs = Date.now(), period = PERIOD_SECONDS) {
  return Math.floor(timeMs / 1000 / period)
}

/** HOTP (RFC 4226): the code for one counter value. */
export function hotp(secret, counter, digits = DIGITS) {
  const key = base32Decode(secret)
  if (key.length === 0) throw new Error('Empty TOTP secret')
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const digest = crypto.createHmac('sha1', key).update(buf).digest()
  // Dynamic truncation, RFC 4226 s5.4.
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(binary % 10 ** digits).padStart(digits, '0')
}

/** The code an authenticator app is showing right now. */
export function totp(secret, { timeMs = Date.now(), digits = DIGITS, period = PERIOD_SECONDS } = {}) {
  return hotp(secret, counterAt(timeMs, period), digits)
}

/**
 * Check a submitted code.
 *
 * Returns `{ ok, counter }`: on success `counter` is the step the code came
 * from, which the caller MUST persist and pass back as `lastCounter` next
 * time. Without that, a code shoulder-surfed or read off a phone stays valid
 * for the rest of its 30-second step and can simply be replayed.
 *
 * @param {object}  options
 * @param {number} [options.lastCounter]  highest counter already accepted for
 *                                        this admin; codes at or below it are
 *                                        refused as replays.
 */
export function verifyTotp(
  secret,
  code,
  { timeMs = Date.now(), window = DEFAULT_WINDOW, digits = DIGITS, period = PERIOD_SECONDS, lastCounter = null } = {}
) {
  const submitted = String(code ?? '').replace(/\D/g, '')
  if (submitted.length !== digits) return { ok: false, counter: null }
  if (!secret) return { ok: false, counter: null }

  const now = counterAt(timeMs, period)
  for (let drift = -window; drift <= window; drift++) {
    const counter = now + drift
    if (counter < 0) continue
    if (lastCounter != null && counter <= lastCounter) continue
    const expected = hotp(secret, counter, digits)
    // Constant-time: a timing difference here leaks how much of a guessed
    // code was right, which is enough to walk a 6-digit space digit by digit.
    const a = Buffer.from(expected)
    const b = Buffer.from(submitted)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true, counter }
  }
  return { ok: false, counter: null }
}

/**
 * The otpauth:// URI an authenticator app imports. `label` is what the admin
 * sees in their app, `issuer` which service it belongs to.
 */
export function otpauthUri({ secret, account, issuer = 'AskNelson' }) {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params}`
}
