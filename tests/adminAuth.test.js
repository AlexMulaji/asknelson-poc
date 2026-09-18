import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_COOKIE } from '../server/adminAuth.js'
import { generateSecret, totp } from '../server/totp.js'
import { startTestServer } from './helpers/testServer.js'

// Admin sign-in, over real HTTP.
//
// The thing worth proving is that the second factor is not decoration: a
// session that has passed the password and nothing else has a valid cookie,
// and must still be refused everywhere except the two routes that finish
// signing in.

const CONTENT = {
  explore: { explore: { themes: [{ id: 'anxiety', title: 'Anxiety', content: [] }] } },
}

async function serverWithEnrolledOwner() {
  const secret = generateSecret()
  const server = await startTestServer({
    admins: [{ email: 'owner@example.com', password: 'a-good-long-password', role: 'owner', totpSecret: secret }],
    content: CONTENT,
  })
  return { server, secret }
}

/** Sign in fully: password, then a current authenticator code. */
async function signIn(server, secret, { email = 'owner@example.com', password = 'a-good-long-password' } = {}) {
  const client = server.client()
  const login = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  assert.equal(login.status, 200, login.text)
  const mfa = await client.request('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: totp(secret) },
  })
  assert.equal(mfa.status, 200, mfa.text)
  return client
}

test('the password alone does not sign you in', async () => {
  const { server, secret } = await serverWithEnrolledOwner()
  const client = server.client()

  const login = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })
  assert.equal(login.status, 200)
  assert.equal(login.body.status, 'mfa_required')
  // A cookie exists — that is how the second step knows who is finishing.
  assert.ok(client.cookies.has(ADMIN_COOKIE))
  // And it grants nothing.
  assert.deepEqual(login.body.admin.permissions, [])

  const blocked = await client.request('/api/content/explore?include=drafts')
  assert.equal(blocked.status, 403)

  const users = await client.request('/api/admin/users')
  assert.equal(users.status, 401)
  assert.equal(users.body.mfaRequired, true)

  await server.close()
  void secret
})

test('the second factor completes sign-in', async () => {
  const { server, secret } = await serverWithEnrolledOwner()
  const client = await signIn(server, secret)

  const me = await client.request('/api/admin/auth/me')
  assert.equal(me.body.status, 'signed_in')
  assert.equal(me.body.admin.role, 'owner')
  assert.ok(me.body.admin.permissions.includes('content:publish'))

  const drafts = await client.request('/api/content/explore?include=drafts')
  assert.equal(drafts.status, 200)

  await server.close()
})

test('a wrong code does not complete sign-in', async () => {
  const { server, secret } = await serverWithEnrolledOwner()
  const client = server.client()
  await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })

  const wrong = await client.request('/api/admin/auth/mfa', { method: 'POST', body: { code: '000000' } })
  assert.equal(wrong.status, 401)

  const me = await client.request('/api/admin/auth/me')
  assert.equal(me.body.status, 'mfa_required')

  // The right code still works afterwards — a wrong guess is not a lockout.
  const right = await client.request('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: totp(secret) },
  })
  assert.equal(right.status, 200)

  await server.close()
})

test('a code cannot be replayed', async () => {
  const { server, secret } = await serverWithEnrolledOwner()
  const code = totp(secret)

  const first = server.client()
  await first.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })
  assert.equal((await first.request('/api/admin/auth/mfa', { method: 'POST', body: { code } })).status, 200)

  // Somebody who read the code over a shoulder, inside the same 30s step.
  const attacker = server.client()
  await attacker.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })
  const replay = await attacker.request('/api/admin/auth/mfa', { method: 'POST', body: { code } })
  assert.equal(replay.status, 401)

  await server.close()
})

test('a wrong password is refused, and says nothing about the account', async () => {
  const { server } = await serverWithEnrolledOwner()
  const client = server.client()

  const wrongPassword = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'not-the-password' },
  })
  const unknownEmail = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'nobody@example.com', password: 'not-the-password' },
  })

  assert.equal(wrongPassword.status, 401)
  assert.equal(unknownEmail.status, 401)
  // Whether an address belongs to an admin is itself worth not confirming.
  assert.equal(wrongPassword.body.error, unknownEmail.body.error)
  assert.equal(client.cookies.has(ADMIN_COOKIE), false)

  await server.close()
})

test('repeated wrong passwords lock the account', async () => {
  const { server, secret } = await serverWithEnrolledOwner()
  const client = server.client()

  for (let i = 0; i < 5; i++) {
    await client.request('/api/admin/auth/login', {
      method: 'POST',
      body: { email: 'owner@example.com', password: `guess-${i}` },
    })
  }

  // Even the right password now.
  const locked = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })
  assert.equal(locked.status, 423)
  assert.ok(locked.body.lockedUntil)

  await server.close()
  void secret
})

test('a successful sign-in clears the failure count', async () => {
  const { server, secret } = await serverWithEnrolledOwner()
  const client = server.client()

  for (let i = 0; i < 3; i++) {
    await client.request('/api/admin/auth/login', {
      method: 'POST',
      body: { email: 'owner@example.com', password: 'wrong' },
    })
  }
  await signIn(server, secret)

  const admin = await server.store.findAdminByEmail('owner@example.com')
  assert.equal(admin.failedLogins, 0)
  assert.equal(admin.lockedUntil, null)

  await server.close()
})

test('a disabled admin cannot sign in', async () => {
  const secret = generateSecret()
  const server = await startTestServer({
    admins: [
      {
        email: 'gone@example.com',
        password: 'a-good-long-password',
        role: 'admin',
        status: 'disabled',
        totpSecret: secret,
      },
    ],
  })
  const client = server.client()
  const login = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'gone@example.com', password: 'a-good-long-password' },
  })
  assert.equal(login.status, 401)
  await server.close()
})

// --- enrolment -------------------------------------------------------------------

test('an admin with no second factor must enrol before doing anything', async () => {
  const server = await startTestServer({
    admins: [{ email: 'new@example.com', password: 'a-good-long-password', role: 'publisher' }],
    content: CONTENT,
  })
  const client = server.client()

  const login = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'new@example.com', password: 'a-good-long-password' },
  })
  assert.equal(login.body.status, 'enrolment_required')

  // Nothing is reachable in that state.
  assert.equal((await client.request('/api/content/explore?include=drafts')).status, 403)

  const setup = await client.request('/api/admin/auth/totp/setup', { method: 'POST' })
  assert.equal(setup.status, 200)
  assert.ok(setup.body.secret)
  assert.match(setup.body.otpauthUri, /^otpauth:\/\/totp\//)

  // A wrong code does not enrol them.
  const wrong = await client.request('/api/admin/auth/totp/enrol', {
    method: 'POST',
    body: { code: '000000' },
  })
  assert.equal(wrong.status, 401)
  assert.equal((await client.request('/api/admin/auth/me')).body.status, 'enrolment_required')

  const enrol = await client.request('/api/admin/auth/totp/enrol', {
    method: 'POST',
    body: { code: totp(setup.body.secret) },
  })
  assert.equal(enrol.status, 200)
  // Recovery codes are shown exactly once, here.
  assert.equal(enrol.body.recoveryCodes.length, 10)

  // Enrolment signs them in, so they do not have to type a second code.
  const me = await client.request('/api/admin/auth/me')
  assert.equal(me.body.status, 'signed_in')
  assert.equal((await client.request('/api/content/explore?include=drafts')).status, 200)

  await server.close()
})

test('an enrolled admin cannot re-enrol to skip the second factor', async () => {
  const { server } = await serverWithEnrolledOwner()
  const client = server.client()
  await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })

  // If this were allowed, the password alone would be enough: mint a new
  // secret, enrol it, and the second factor is whatever the attacker chose.
  const setup = await client.request('/api/admin/auth/totp/setup', { method: 'POST' })
  assert.equal(setup.status, 409)

  await server.close()
})

// --- recovery codes ---------------------------------------------------------------

test('a recovery code signs you in, once', async () => {
  const server = await startTestServer({
    admins: [{ email: 'new@example.com', password: 'a-good-long-password', role: 'admin' }],
  })
  const enrolling = server.client()
  await enrolling.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'new@example.com', password: 'a-good-long-password' },
  })
  const setup = await enrolling.request('/api/admin/auth/totp/setup', { method: 'POST' })
  const enrolled = await enrolling.request('/api/admin/auth/totp/enrol', {
    method: 'POST',
    body: { code: totp(setup.body.secret) },
  })
  const [recoveryCode] = enrolled.body.recoveryCodes

  // The lost-phone path.
  const lostPhone = server.client()
  await lostPhone.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'new@example.com', password: 'a-good-long-password' },
  })
  const used = await lostPhone.request('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: recoveryCode },
  })
  assert.equal(used.status, 200)
  assert.equal(used.body.recoveryCodesRemaining, 9)

  // The same code a second time is refused.
  const again = server.client()
  await again.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'new@example.com', password: 'a-good-long-password' },
  })
  const reused = await again.request('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: recoveryCode },
  })
  assert.equal(reused.status, 401)

  await server.close()
})

test('recovery codes are accepted however they are typed', async () => {
  const server = await startTestServer({
    admins: [{ email: 'new@example.com', password: 'a-good-long-password', role: 'admin' }],
  })
  const client = server.client()
  await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'new@example.com', password: 'a-good-long-password' },
  })
  const setup = await client.request('/api/admin/auth/totp/setup', { method: 'POST' })
  const enrolled = await client.request('/api/admin/auth/totp/enrol', {
    method: 'POST',
    body: { code: totp(setup.body.secret) },
  })
  const code = enrolled.body.recoveryCodes[0]

  const messy = server.client()
  await messy.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'new@example.com', password: 'a-good-long-password' },
  })
  // Read off a printout: lower case, spaces instead of the hyphen.
  const typed = code.toLowerCase().replace('-', ' ')
  const result = await messy.request('/api/admin/auth/mfa', { method: 'POST', body: { code: typed } })
  assert.equal(result.status, 200)

  await server.close()
})

// --- sessions -----------------------------------------------------------------------

test('signing out ends the session', async () => {
  const { server, secret } = await serverWithEnrolledOwner()
  const client = await signIn(server, secret)

  await client.request('/api/admin/auth/logout', { method: 'POST' })
  assert.equal((await client.request('/api/admin/auth/me')).status, 401)
  assert.equal((await client.request('/api/content/explore?include=drafts')).status, 403)

  await server.close()
})

test('an expired session is not accepted', async () => {
  const secret = generateSecret()
  let clock = new Date('2026-03-01T09:00:00Z')
  const server = await startTestServer({
    admins: [{ email: 'owner@example.com', password: 'a-good-long-password', role: 'owner', totpSecret: secret }],
    content: CONTENT,
    now: () => clock,
  })

  const client = server.client()
  await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })
  await client.request('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: totp(secret, { timeMs: clock.getTime() }) },
  })
  assert.equal((await client.request('/api/admin/auth/me')).status, 200)

  // Past the 12-hour session lifetime.
  clock = new Date('2026-03-02T09:00:00Z')
  assert.equal((await client.request('/api/admin/auth/me')).status, 401)

  await server.close()
})

test('the half-finished session expires quickly', async () => {
  const secret = generateSecret()
  let clock = new Date('2026-03-01T09:00:00Z')
  const server = await startTestServer({
    admins: [{ email: 'owner@example.com', password: 'a-good-long-password', role: 'owner', totpSecret: secret }],
    now: () => clock,
  })

  const client = server.client()
  await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })

  // Walked away mid-sign-in. Nothing useful can be done with that session, and
  // it should not sit around for hours waiting to be finished.
  clock = new Date('2026-03-01T09:20:00Z')
  const late = await client.request('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: totp(secret, { timeMs: clock.getTime() }) },
  })
  assert.equal(late.status, 401)

  await server.close()
})

test('a forged cookie is not a session', async () => {
  const { server } = await serverWithEnrolledOwner()
  const client = server.client()
  const guess = await client.request('/api/admin/auth/me', {
    headers: { cookie: `${ADMIN_COOKIE}=not-a-real-token` },
  })
  assert.equal(guess.status, 401)
  await server.close()
})

test('the session cookie is httpOnly, same-site and path-scoped', async () => {
  const { server } = await serverWithEnrolledOwner()
  const client = server.client()
  const login = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'a-good-long-password' },
  })
  const cookie = login.headers.getSetCookie().find((c) => c.startsWith(ADMIN_COOKIE))
  // httpOnly is what keeps an XSS bug from lifting an admin session.
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Strict/i)
  assert.match(cookie, /Path=\//)
  await server.close()
})

// --- password changes ---------------------------------------------------------------

test('changing a password needs the current one, and ends other sessions', async () => {
  // Two sign-ins on a controlled clock: a code is single-use, so the second
  // session has to come from a later step — exactly as it would in life.
  const secret = generateSecret()
  let clock = new Date('2026-03-01T09:00:00Z')
  const server = await startTestServer({
    admins: [
      { email: 'owner@example.com', password: 'a-good-long-password', role: 'owner', totpSecret: secret },
    ],
    now: () => clock,
  })

  const signInAt = async () => {
    const client = server.client()
    await client.request('/api/admin/auth/login', {
      method: 'POST',
      body: { email: 'owner@example.com', password: 'a-good-long-password' },
    })
    const mfa = await client.request('/api/admin/auth/mfa', {
      method: 'POST',
      body: { code: totp(secret, { timeMs: clock.getTime() }) },
    })
    assert.equal(mfa.status, 200, mfa.text)
    return client
  }

  const desktop = await signInAt()
  // A second signed-in session, on another machine, a minute later.
  clock = new Date('2026-03-01T09:01:00Z')
  const laptop = await signInAt()

  const wrong = await desktop.request('/api/admin/auth/password', {
    method: 'POST',
    body: { currentPassword: 'nope', newPassword: 'another-good-password' },
  })
  assert.equal(wrong.status, 401)

  const weak = await desktop.request('/api/admin/auth/password', {
    method: 'POST',
    body: { currentPassword: 'a-good-long-password', newPassword: 'short' },
  })
  assert.equal(weak.status, 400)

  const changed = await desktop.request('/api/admin/auth/password', {
    method: 'POST',
    body: { currentPassword: 'a-good-long-password', newPassword: 'another-good-password' },
  })
  assert.equal(changed.status, 200)

  // The tab that made the change stays signed in; every other one does not.
  assert.equal((await desktop.request('/api/admin/auth/me')).status, 200)
  assert.equal((await laptop.request('/api/admin/auth/me')).status, 401)

  await server.close()
})

test('sign-in and failures are written to the audit trail', async () => {
  const { server, secret } = await serverWithEnrolledOwner()
  const client = server.client()

  await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'wrong' },
  })
  await signIn(server, secret)

  const actions = server.audited.map((e) => e.action)
  assert.ok(actions.includes('admin_login_failed'))
  assert.ok(actions.includes('admin_signed_in'))

  await server.close()
})
