import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecret, totp } from '../server/totp.js'

// Demo mode for admin two-factor (ADMIN_MFA_ECHO), the counterpart of OTP_ECHO
// for member sign-up.
//
// The flag is read once at module load, so each state needs its own module
// instance — hence the dynamic imports with a cache-busting query below. Two
// things matter and both are asserted: that it is off unless explicitly set,
// and that even when on it is never reachable by someone who has not already
// passed the password.

/** Load a fresh copy of the server modules with ADMIN_MFA_ECHO set as given. */
async function loadWithEcho(enabled) {
  const previous = process.env.ADMIN_MFA_ECHO
  if (enabled) process.env.ADMIN_MFA_ECHO = 'true'
  else delete process.env.ADMIN_MFA_ECHO

  // A distinct query string gives each call its own module registry entry.
  const bust = `?echo=${enabled}-${Math.random()}`
  const express = (await import('express')).default
  const auth = await import(`../server/adminAuth.js${bust}`)
  const store = await import(`../server/adminStore.js${bust}`)
  const passwords = await import(`../server/passwords.js${bust}`)

  if (previous === undefined) delete process.env.ADMIN_MFA_ECHO
  else process.env.ADMIN_MFA_ECHO = previous

  return { express, auth, store, passwords }
}

/** A running admin API with one enrolled owner, at the given echo setting. */
async function serverWithEcho(enabled) {
  const { express, auth, store: storeModule, passwords } = await loadWithEcho(enabled)
  const secret = generateSecret()
  const store = storeModule.createMemoryAdminStore()
  const admin = await store.createAdmin({
    email: 'owner@example.com',
    role: 'owner',
    status: 'active',
    passwordHash: await passwords.hashPassword('a-good-long-password'),
  })
  await store.updateAdmin(admin.id, {
    totpSecret: secret,
    totpEnrolledAt: new Date().toISOString(),
  })

  const app = express()
  app.use(auth.createAdminSessionMiddleware({ store }))
  app.use('/api/admin/auth', auth.createAdminAuthRouter({ store }))

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const jar = new Map()

  const call = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: json }
  }

  const password = () =>
    call('/api/admin/auth/login', {
      method: 'POST',
      body: { email: 'owner@example.com', password: 'a-good-long-password' },
    })

  return {
    call,
    password,
    secret,
    adminMfaEcho: auth.adminMfaEcho,
    close: () => new Promise((resolve) => server.close(resolve)),
    freshClient: () => jar.clear(),
  }
}

test('demo mode is off unless it is explicitly switched on', async () => {
  const server = await serverWithEcho(false)
  assert.equal(server.adminMfaEcho, false)

  await server.password()
  // A 404 rather than a 403: a probe cannot tell demo mode from a build that
  // never had the endpoint.
  const echo = await server.call('/api/admin/auth/totp/echo')
  assert.equal(echo.status, 404)

  const me = await server.call('/api/admin/auth/me')
  assert.equal(me.body.mfaEcho, false)

  await server.close()
})

test('with demo mode off, nothing in the API leaks a usable code', async () => {
  const server = await serverWithEcho(false)
  await server.password()
  const me = await server.call('/api/admin/auth/me')
  // The response must not carry anything that could be entered as a code.
  assert.equal(JSON.stringify(me.body).includes(totp(server.secret)), false)
  await server.close()
})

test('with demo mode on, the code is offered and it works', async () => {
  const server = await serverWithEcho(true)
  assert.equal(server.adminMfaEcho, true)

  await server.password()
  const me = await server.call('/api/admin/auth/me')
  assert.equal(me.body.mfaEcho, true)
  assert.equal(me.body.status, 'mfa_required')

  const echo = await server.call('/api/admin/auth/totp/echo')
  assert.equal(echo.status, 200)
  assert.match(echo.body.code, /^\d{6}$/)
  // The countdown drives the screen's refresh, so it has to be a real number
  // of seconds inside one step.
  assert.ok(echo.body.expiresInSeconds > 0 && echo.body.expiresInSeconds <= 30)

  const submitted = await server.call('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: echo.body.code },
  })
  assert.equal(submitted.status, 200)
  assert.equal((await server.call('/api/admin/auth/me')).body.status, 'signed_in')

  await server.close()
})

test('the code is never handed out before the password', async () => {
  // The whole containment story: demo mode weakens the second factor, and must
  // not touch the first.
  const server = await serverWithEcho(true)

  const echo = await server.call('/api/admin/auth/totp/echo')
  assert.equal(echo.status, 401)

  const me = await server.call('/api/admin/auth/me')
  assert.equal(me.status, 401)

  await server.close()
})

test('a wrong password still yields nothing, with demo mode on', async () => {
  const server = await serverWithEcho(true)

  const login = await server.call('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'owner@example.com', password: 'not-the-password' },
  })
  assert.equal(login.status, 401)
  assert.equal((await server.call('/api/admin/auth/totp/echo')).status, 401)

  await server.close()
})

test('enrolment hands back the first code so setup can complete', async () => {
  const { express, auth, store: storeModule, passwords } = await loadWithEcho(true)
  const store = storeModule.createMemoryAdminStore()
  // A brand new admin with no second factor — the case that blocks somebody
  // with no authenticator app to hand.
  await store.createAdmin({
    email: 'new@example.com',
    role: 'owner',
    status: 'active',
    passwordHash: await passwords.hashPassword('a-good-long-password'),
  })

  const app = express()
  app.use(auth.createAdminSessionMiddleware({ store }))
  app.use('/api/admin/auth', auth.createAdminAuthRouter({ store }))
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const jar = new Map()
  const call = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }

  await call('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'new@example.com', password: 'a-good-long-password' },
  })
  const setup = await call('/api/admin/auth/totp/setup', { method: 'POST' })
  assert.equal(setup.status, 200)
  assert.match(setup.body.echo.code, /^\d{6}$/)

  const enrolled = await call('/api/admin/auth/totp/enrol', {
    method: 'POST',
    body: { code: setup.body.echo.code },
  })
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.body))
  assert.equal(enrolled.body.recoveryCodes.length, 10)

  await new Promise((resolve) => server.close(resolve))
})
