import test from 'node:test'
import assert from 'node:assert/strict'
import {
  base32Decode,
  base32Encode,
  counterAt,
  formatSecret,
  generateSecret,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
} from '../server/totp.js'

// The second factor on the admin portal. Wrong here means either admins
// cannot sign in, or a code stays usable after it should not — so this is
// checked against the published vectors rather than against itself.

const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'))

test('matches the RFC 6238 test vectors', () => {
  // Appendix B, the SHA-1 rows. Eight digits, which is what the RFC tabulates;
  // the portal uses six, taken from the same value.
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]
  for (const [seconds, expected] of vectors) {
    assert.equal(hotp(RFC_SECRET, counterAt(seconds * 1000), 8), expected, `at t=${seconds}`)
  }
})

test('six-digit codes are the last six of the RFC value', () => {
  assert.equal(totp(RFC_SECRET, { timeMs: 59_000 }), '287082')
})

test('base32 round-trips, and tolerates the spaces people paste', () => {
  for (const length of [1, 2, 3, 4, 5, 10, 20, 32]) {
    const bytes = Buffer.alloc(length, length)
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes, `length ${length}`)
  }
  const secret = generateSecret()
  assert.deepEqual(base32Decode(formatSecret(secret)), base32Decode(secret))
  assert.deepEqual(base32Decode(`${secret.toLowerCase()}====`), base32Decode(secret))
})

test('rejects a secret that is not base32', () => {
  assert.throws(() => base32Decode('not-valid-1!'), /Invalid base32/)
})

test('generated secrets are 160 bits and not repeated', () => {
  const secrets = new Set()
  for (let i = 0; i < 50; i++) {
    const secret = generateSecret()
    assert.equal(base32Decode(secret).length, 20)
    secrets.add(secret)
  }
  assert.equal(secrets.size, 50)
})

test('accepts the current code', () => {
  const secret = generateSecret()
  const at = 1_700_000_000_000
  assert.equal(verifyTotp(secret, totp(secret, { timeMs: at }), { timeMs: at }).ok, true)
})

test('tolerates one step of clock drift, but no more', () => {
  const secret = generateSecret()
  const at = 1_700_000_000_000
  const step = 30_000

  // A code from the previous or next step still works: phones drift, and a
  // code typed as it rolls over should not be refused.
  for (const drift of [-step, step]) {
    const code = totp(secret, { timeMs: at + drift })
    assert.equal(verifyTotp(secret, code, { timeMs: at }).ok, true, `drift ${drift}ms`)
  }
  // Two steps out is a minute stale — refused.
  for (const drift of [-2 * step, 2 * step]) {
    const code = totp(secret, { timeMs: at + drift })
    assert.equal(verifyTotp(secret, code, { timeMs: at }).ok, false, `drift ${drift}ms`)
  }
})

test('refuses a code that has already been used', () => {
  const secret = generateSecret()
  const at = 1_700_000_000_000
  const code = totp(secret, { timeMs: at })

  const first = verifyTotp(secret, code, { timeMs: at })
  assert.equal(first.ok, true)
  assert.equal(typeof first.counter, 'number')

  // Replay within the same 30-second step, with the counter the caller stored:
  // a code read over somebody's shoulder must not still work.
  const replay = verifyTotp(secret, code, { timeMs: at + 5_000, lastCounter: first.counter })
  assert.equal(replay.ok, false)
})

test('a used code does not block the next one', () => {
  const secret = generateSecret()
  const at = 1_700_000_000_000
  const used = verifyTotp(secret, totp(secret, { timeMs: at }), { timeMs: at })

  const next = at + 30_000
  const result = verifyTotp(secret, totp(secret, { timeMs: next }), {
    timeMs: next,
    lastCounter: used.counter,
  })
  assert.equal(result.ok, true)
  assert.equal(result.counter, used.counter + 1)
})

test('rejects malformed, empty and wrong-length submissions', () => {
  const secret = generateSecret()
  const at = 1_700_000_000_000
  for (const code of [null, undefined, '', '12345', '1234567', 'abcdef', '  ', {}]) {
    assert.equal(verifyTotp(secret, code, { timeMs: at }).ok, false, `code ${JSON.stringify(code)}`)
  }
})

test('rejects every code when no secret is enrolled', () => {
  const at = 1_700_000_000_000
  assert.equal(verifyTotp(null, '123456', { timeMs: at }).ok, false)
  assert.equal(verifyTotp('', '123456', { timeMs: at }).ok, false)
})

test("a code from a different secret does not verify", () => {
  const mine = generateSecret()
  const theirs = generateSecret()
  const at = 1_700_000_000_000
  assert.equal(verifyTotp(mine, totp(theirs, { timeMs: at }), { timeMs: at }).ok, false)
})

test('the otpauth URI carries what an authenticator app needs', () => {
  const secret = generateSecret()
  const uri = new URL(otpauthUri({ secret, account: 'sam@example.com' }))
  assert.equal(uri.protocol, 'otpauth:')
  assert.equal(uri.host, 'totp')
  assert.equal(decodeURIComponent(uri.pathname), '/AskNelson:sam@example.com')
  assert.equal(uri.searchParams.get('secret'), secret)
  assert.equal(uri.searchParams.get('issuer'), 'AskNelson')
  assert.equal(uri.searchParams.get('digits'), '6')
  assert.equal(uri.searchParams.get('period'), '30')
})
