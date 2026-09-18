import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureBootstrapAdmin } from '../server/adminAuth.js'
import { canManage } from '../server/rbac.js'
import { createMemoryAdminStore } from '../server/adminStore.js'
import { generateSecret, totp } from '../server/totp.js'
import { verifyPassword } from '../server/passwords.js'
import { startTestServer } from './helpers/testServer.js'

// Managing admin accounts. This is the one place in the portal where
// privilege is handed out, so the tests are mostly about what must *not* be
// possible from inside it.

async function serverWithOwnerAndEditor() {
  const secrets = { owner: generateSecret(), editor: generateSecret() }
  const server = await startTestServer({
    admins: [
      { email: 'owner@example.com', password: 'a-good-long-password', role: 'owner', totpSecret: secrets.owner },
      { email: 'editor@example.com', password: 'a-good-long-password', role: 'editor', totpSecret: secrets.editor },
    ],
  })
  return { server, secrets }
}

async function as(server, secrets, role) {
  const client = server.client()
  await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: `${role}@example.com`, password: 'a-good-long-password' },
  })
  const mfa = await client.request('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: totp(secrets[role]) },
  })
  assert.equal(mfa.status, 200, mfa.text)
  return client
}

test('only an owner sees the admin list', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()

  const editor = await as(server, secrets, 'editor')
  assert.equal((await editor.request('/api/admin/users')).status, 403)

  const owner = await as(server, secrets, 'owner')
  const list = await owner.request('/api/admin/users')
  assert.equal(list.status, 200)
  assert.equal(list.body.admins.length, 2)
  // The roles and what each can do come from the server, so the UI cannot
  // drift from rbac.js.
  assert.ok(list.body.roles.some((r) => r.name === 'publisher' && r.permissions.includes('content:publish')))

  await server.close()
})

test('the list never carries a password hash or a TOTP secret', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const owner = await as(server, secrets, 'owner')
  const list = await owner.request('/api/admin/users')

  assert.equal(list.text.includes('scrypt$'), false)
  assert.equal(list.text.includes(secrets.owner), false)
  for (const admin of list.body.admins) {
    assert.equal('passwordHash' in admin, false)
    assert.equal('totpSecret' in admin, false)
    // Whether they have set up a second factor is reportable; the secret is not.
    assert.equal(typeof admin.mfaEnrolled, 'boolean')
  }

  await server.close()
})

test('an owner can create an admin, who must then enrol a second factor', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const owner = await as(server, secrets, 'owner')

  const created = await owner.request('/api/admin/users', {
    method: 'POST',
    body: { email: 'new@example.com', name: 'Sam', role: 'publisher', password: 'a-good-long-password' },
  })
  assert.equal(created.status, 201, created.text)
  assert.equal(created.body.admin.role, 'publisher')
  assert.equal(created.body.admin.mfaEnrolled, false)

  const login = await server.client().request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'new@example.com', password: 'a-good-long-password' },
  })
  assert.equal(login.body.status, 'enrolment_required')

  await server.close()
})

test('creating an admin validates the email, role and password', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const owner = await as(server, secrets, 'owner')

  const cases = [
    [{ email: 'not-an-email', role: 'editor', password: 'a-good-long-password' }, 400],
    [{ email: 'x@example.com', role: 'wizard', password: 'a-good-long-password' }, 400],
    [{ email: 'x@example.com', role: '__proto__', password: 'a-good-long-password' }, 400],
    [{ email: 'x@example.com', role: 'editor', password: 'short' }, 400],
    [{ email: 'x@example.com', role: 'editor', password: 'password123' }, 400],
    [{ email: 'owner@example.com', role: 'editor', password: 'a-good-long-password' }, 409],
  ]
  for (const [body, status] of cases) {
    const res = await owner.request('/api/admin/users', { method: 'POST', body })
    assert.equal(res.status, status, JSON.stringify(body))
  }

  await server.close()
})

test('an email is one account however it is capitalised', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const owner = await as(server, secrets, 'owner')

  const res = await owner.request('/api/admin/users', {
    method: 'POST',
    body: { email: 'OWNER@Example.COM', role: 'editor', password: 'a-good-long-password' },
  })
  assert.equal(res.status, 409)

  await server.close()
})

test('nobody can promote themselves', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const owner = await as(server, secrets, 'owner')
  const me = server.admins['owner@example.com']

  const res = await owner.request(`/api/admin/users/${me.id}`, {
    method: 'PATCH',
    body: { role: 'editor' },
  })
  assert.equal(res.status, 403)
  assert.equal((await server.store.findAdminById(me.id)).role, 'owner')

  await server.close()
})

test('nobody can disable or delete themselves', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const owner = await as(server, secrets, 'owner')
  const me = server.admins['owner@example.com']

  assert.equal(
    (await owner.request(`/api/admin/users/${me.id}`, { method: 'PATCH', body: { status: 'disabled' } }))
      .status,
    403
  )
  assert.equal((await owner.request(`/api/admin/users/${me.id}`, { method: 'DELETE' })).status, 403)

  await server.close()
})

test('the portal always keeps someone who can hand roles back', () => {
  // Two rules together guarantee it, and it is worth being explicit about
  // which does the work:
  //
  //   1. nobody may change their own role or status, so the sole owner cannot
  //      demote themselves out of the only account that can grant the role
  //   2. only an owner may change an owner, and only an owner holds
  //      admin:manage at all
  //
  // Together those make "demote the last owner" unreachable over HTTP today —
  // which is why the test below asserts the rules rather than trying to
  // provoke the orphan check. canManage covers (1) and (2) directly; the
  // orphan check in the router is the backstop for the day a role other than
  // owner is given admin:manage.
  const soleOwner = { id: 'o1', role: 'owner', status: 'active', mfaVerified: true }
  assert.equal(canManage(soleOwner, { id: 'o1', role: 'owner' }, { role: 'editor' }).ok, false)
  assert.equal(canManage(soleOwner, { id: 'o1', role: 'owner' }, { status: 'disabled' }).ok, false)

  const administrator = { id: 'm1', role: 'admin', status: 'active', mfaVerified: true }
  assert.equal(canManage(administrator, { id: 'o1', role: 'owner' }, { role: 'editor' }).ok, false)
})

test('one owner demoting another leaves an owner behind', async () => {
  const secrets = { a: generateSecret(), b: generateSecret() }
  const server = await startTestServer({
    admins: [
      { email: 'a@example.com', password: 'a-good-long-password', role: 'owner', totpSecret: secrets.a },
      { email: 'b@example.com', password: 'a-good-long-password', role: 'owner', totpSecret: secrets.b },
    ],
  })

  const a = server.client()
  await a.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'a@example.com', password: 'a-good-long-password' },
  })
  await a.request('/api/admin/auth/mfa', { method: 'POST', body: { code: totp(secrets.a) } })

  const demoteB = await a.request(`/api/admin/users/${server.admins['b@example.com'].id}`, {
    method: 'PATCH',
    body: { role: 'editor' },
  })
  assert.equal(demoteB.status, 200, demoteB.text)

  const list = await a.request('/api/admin/users')
  const owners = list.body.admins.filter((x) => x.role === 'owner' && x.status === 'active')
  assert.equal(owners.length, 1)
  assert.equal(owners[0].email, 'a@example.com')

  // And A cannot now demote itself, so that last owner stays.
  const selfDemote = await a.request(`/api/admin/users/${server.admins['a@example.com'].id}`, {
    method: 'PATCH',
    body: { role: 'editor' },
  })
  assert.equal(selfDemote.status, 403)

  await server.close()
})

test('a demotion ends the demoted admin’s sessions immediately', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const editor = await as(server, secrets, 'editor')
  assert.equal((await editor.request('/api/admin/auth/me')).status, 200)

  const owner = await as(server, secrets, 'owner')
  await owner.request(`/api/admin/users/${server.admins['editor@example.com'].id}`, {
    method: 'PATCH',
    body: { role: 'analyst' },
  })

  // Not "at their next sign-in": a role change has to take effect now.
  assert.equal((await editor.request('/api/admin/auth/me')).status, 401)

  await server.close()
})

test('disabling an admin ends their session and blocks sign-in', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const editor = await as(server, secrets, 'editor')
  const owner = await as(server, secrets, 'owner')

  await owner.request(`/api/admin/users/${server.admins['editor@example.com'].id}`, {
    method: 'PATCH',
    body: { status: 'disabled' },
  })
  assert.equal((await editor.request('/api/admin/auth/me')).status, 401)

  const retry = await server.client().request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'editor@example.com', password: 'a-good-long-password' },
  })
  assert.equal(retry.status, 401)

  await server.close()
})

test('an owner can reset a password, which also ends their sessions', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const editor = await as(server, secrets, 'editor')
  const owner = await as(server, secrets, 'owner')

  const res = await owner.request(`/api/admin/users/${server.admins['editor@example.com'].id}`, {
    method: 'PATCH',
    body: { password: 'a-brand-new-password' },
  })
  assert.equal(res.status, 200)
  assert.equal((await editor.request('/api/admin/auth/me')).status, 401)

  const updated = await server.store.findAdminByEmail('editor@example.com')
  assert.equal(await verifyPassword('a-brand-new-password', updated.passwordHash), true)
  assert.equal(await verifyPassword('a-good-long-password', updated.passwordHash), false)

  await server.close()
})

test('resetting a second factor clears it and ends their sessions', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const editor = await as(server, secrets, 'editor')
  const owner = await as(server, secrets, 'owner')

  // The lost-phone path, when the recovery codes are gone too.
  const res = await owner.request(
    `/api/admin/users/${server.admins['editor@example.com'].id}/reset-mfa`,
    { method: 'POST' }
  )
  assert.equal(res.status, 200)
  // It must not be usable to walk into a portal that is already open.
  assert.equal((await editor.request('/api/admin/auth/me')).status, 401)

  const after = await server.store.findAdminByEmail('editor@example.com')
  assert.equal(after.totpSecret, null)
  assert.equal(after.totpEnrolledAt, null)
  assert.equal(await server.store.countRecoveryCodes(after.id), 0)

  // Their old authenticator code no longer works; they must enrol again.
  const login = await server.client().request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: 'editor@example.com', password: 'a-good-long-password' },
  })
  assert.equal(login.body.status, 'enrolment_required')

  await server.close()
})

test('deleting an admin removes their sessions with them', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const editor = await as(server, secrets, 'editor')
  const owner = await as(server, secrets, 'owner')

  const res = await owner.request(`/api/admin/users/${server.admins['editor@example.com'].id}`, {
    method: 'DELETE',
  })
  assert.equal(res.status, 200)
  assert.equal((await editor.request('/api/admin/auth/me')).status, 401)
  assert.equal(await server.store.findAdminByEmail('editor@example.com'), null)

  await server.close()
})

test('account changes are written to the audit trail', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const owner = await as(server, secrets, 'owner')

  await owner.request('/api/admin/users', {
    method: 'POST',
    body: { email: 'new@example.com', role: 'editor', password: 'a-good-long-password' },
  })
  await owner.request(`/api/admin/users/${server.admins['editor@example.com'].id}`, {
    method: 'PATCH',
    body: { role: 'analyst' },
  })

  const actions = server.audited.map((e) => e.action)
  assert.ok(actions.includes('admin_account_created'))
  assert.ok(actions.includes('admin_account_updated'))

  await server.close()
})

test('a request for an admin who does not exist is a 404', async () => {
  const { server, secrets } = await serverWithOwnerAndEditor()
  const owner = await as(server, secrets, 'owner')
  assert.equal(
    (await owner.request('/api/admin/users/00000000-0000-4000-8000-000000000000', { method: 'DELETE' }))
      .status,
    404
  )
  await server.close()
})

// --- bootstrap --------------------------------------------------------------------

test('the first owner is created from the environment', async () => {
  const store = createMemoryAdminStore()
  const result = await ensureBootstrapAdmin(store, {
    email: 'first@example.com',
    password: 'a-good-long-password',
  })
  assert.equal(result.created, true)

  const admin = await store.findAdminByEmail('first@example.com')
  assert.equal(admin.role, 'owner')
  // No second factor yet: their first sign-in has to enrol one.
  assert.equal(admin.totpEnrolledAt, null)
})

test('bootstrap never runs against a store that already has admins', async () => {
  // Otherwise setting an environment variable would be a way to re-take an
  // existing installation.
  const store = createMemoryAdminStore()
  await ensureBootstrapAdmin(store, { email: 'first@example.com', password: 'a-good-long-password' })

  const second = await ensureBootstrapAdmin(store, {
    email: 'attacker@example.com',
    password: 'a-good-long-password',
  })
  assert.equal(second.created, false)
  assert.equal(second.reason, 'admins-exist')
  assert.equal(await store.countAdmins(), 1)
  assert.equal(await store.findAdminByEmail('attacker@example.com'), null)
})

test('bootstrap refuses a weak password and an incomplete configuration', async () => {
  const store = createMemoryAdminStore()
  assert.equal((await ensureBootstrapAdmin(store, {})).reason, 'not-configured')
  assert.equal((await ensureBootstrapAdmin(store, { email: 'a@b.com' })).reason, 'not-configured')
  assert.match(
    (await ensureBootstrapAdmin(store, { email: 'a@b.com', password: 'admin' })).reason,
    /at least/
  )
  assert.equal(await store.countAdmins(), 0)
})
