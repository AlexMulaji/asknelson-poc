import test from 'node:test'
import assert from 'node:assert/strict'
import { MIN_PASSWORD, hashPassword, passwordProblem, verifyPassword } from '../server/passwords.js'

// One password implementation, shared by member accounts and admin accounts.

test('a hash verifies against its own password and nothing else', async () => {
  const hash = await hashPassword('correct horse battery staple')
  assert.equal(await verifyPassword('correct horse battery staple', hash), true)
  assert.equal(await verifyPassword('correct horse battery stapl', hash), false)
  assert.equal(await verifyPassword('Correct Horse Battery Staple', hash), false)
  assert.equal(await verifyPassword('', hash), false)
})

test('the same password hashes differently every time', async () => {
  // A shared salt would let one rainbow table cover every account.
  const a = await hashPassword('a-good-long-password')
  const b = await hashPassword('a-good-long-password')
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('a-good-long-password', a), true)
  assert.equal(await verifyPassword('a-good-long-password', b), true)
})

test('the stored hash names its own parameters', async () => {
  // So the cost can be raised later without invalidating existing hashes.
  const hash = await hashPassword('a-good-long-password')
  const [scheme, N, r, p, salt, key] = hash.split('$')
  assert.equal(scheme, 'scrypt')
  assert.equal(Number(N), 32768)
  assert.equal(Number(r), 8)
  assert.equal(Number(p), 1)
  assert.ok(Buffer.from(salt, 'base64').length >= 16)
  assert.equal(Buffer.from(key, 'base64').length, 64)
})

test('a hash written with weaker parameters still verifies', async () => {
  const weak = await hashPassword('a-good-long-password', { N: 1024, r: 8, p: 1, keylen: 64 })
  assert.equal(await verifyPassword('a-good-long-password', weak), true)
})

test('an unreadable hash is a failed check, never an exception', async () => {
  // A corrupt row must not take a sign-in request down with a 500.
  for (const stored of [
    null,
    undefined,
    '',
    'not-a-hash',
    'scrypt$$$$',
    'bcrypt$10$abc$def',
    'scrypt$32768$8$1$notbase64!$alsonot!',
    'scrypt$abc$def$ghi$aGk=$aGk=',
  ]) {
    assert.equal(await verifyPassword('anything', stored), false, `stored ${JSON.stringify(stored)}`)
  }
})

test('an absurdly long password is refused rather than hashed', async () => {
  // Hashing is deliberately slow, so an unbounded input is a free way to tie
  // up the event loop.
  const huge = 'x'.repeat(100_000)
  await assert.rejects(() => hashPassword(huge), /too long/)
  assert.equal(await verifyPassword(huge, await hashPassword('short-but-fine-password')), false)
})

test('the policy is length first', () => {
  assert.equal(passwordProblem('a-good-long-password'), null)
  assert.match(passwordProblem('short'), new RegExp(`at least ${MIN_PASSWORD}`))
  assert.match(passwordProblem(''), /at least/)
  assert.match(passwordProblem(null), /at least/)
})

test('the obvious passwords are refused', () => {
  for (const password of ['password', 'Password123', 'ADMIN123', 'asknelson', '12345678']) {
    assert.ok(passwordProblem(password), `"${password}" was accepted`)
  }
})

test('the policy imposes no composition rules', () => {
  // NIST SP 800-63B drops "must contain a symbol" deliberately: it pushes
  // people towards P@ssw0rd1 and buys nothing against a rule engine.
  assert.equal(passwordProblem('the quiet blue harbour'), null)
  assert.equal(passwordProblem('aaaaaaaaaaaaaaaa'), null)
})

test('the minimum can be raised per call', () => {
  assert.match(passwordProblem('exactlyten', { min: 12 }), /at least 12/)
  assert.equal(passwordProblem('exactlyten', { min: 10 }), null)
})
