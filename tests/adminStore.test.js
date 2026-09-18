import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createFileAdminStore, createMemoryAdminStore, normaliseEmail } from '../server/adminStore.js'
import { tempDir } from './helpers/testServer.js'

// The admin account store. The memory and file backings share one
// implementation, so the behaviour is tested once and persistence separately.

const admin = (overrides = {}) => ({
  email: 'sam@example.com',
  name: 'Sam',
  role: 'editor',
  status: 'active',
  passwordHash: 'scrypt$1$1$1$c2FsdA==$a2V5',
  ...overrides,
})

test('an email address is one account however it is written', async () => {
  const store = createMemoryAdminStore()
  await store.createAdmin(admin({ email: '  Sam@Example.COM ' }))

  assert.ok(await store.findAdminByEmail('sam@example.com'))
  assert.ok(await store.findAdminByEmail('SAM@EXAMPLE.COM'))
  assert.ok(await store.findAdminByEmail('  sam@example.com  '))
  assert.equal(normaliseEmail(' A@B.com '), 'a@b.com')
})

test('a duplicate email is refused, with a code the router can act on', async () => {
  const store = createMemoryAdminStore()
  await store.createAdmin(admin())
  await assert.rejects(
    () => store.createAdmin(admin({ email: 'SAM@example.com' })),
    (err) => err.code === 'DUPLICATE'
  )
  assert.equal(await store.countAdmins(), 1)
})

test('a new admin starts with no second factor and no failures', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())
  assert.equal(created.totpSecret, null)
  assert.equal(created.totpEnrolledAt, null)
  assert.equal(created.totpLastCounter, null)
  assert.equal(created.failedLogins, 0)
  assert.equal(created.lockedUntil, null)
  assert.ok(created.id)
})

test('updates touch only the fields they name', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())

  const updated = await store.updateAdmin(created.id, { role: 'publisher' })
  assert.equal(updated.role, 'publisher')
  assert.equal(updated.email, created.email)
  assert.equal(updated.passwordHash, created.passwordHash)
})

test('an unknown field cannot be smuggled into a record', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())
  const updated = await store.updateAdmin(created.id, { id: 'hijacked', createdAt: 'nope', nonsense: 1 })
  assert.equal(updated.id, created.id)
  assert.equal(updated.createdAt, created.createdAt)
  assert.equal('nonsense' in updated, false)
})

test('updating an admin who does not exist returns null', async () => {
  const store = createMemoryAdminStore()
  assert.equal(await store.updateAdmin('nope', { role: 'owner' }), null)
  assert.equal(await store.findAdminById('nope'), null)
  assert.equal(await store.findAdminByEmail('nope@example.com'), null)
  assert.equal(await store.findAdminByEmail(''), null)
})

test('records handed out are copies, not the live object', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())

  const copy = await store.findAdminById(created.id)
  copy.role = 'owner'
  assert.equal((await store.findAdminById(created.id)).role, 'editor')
})

test('deleting an admin takes their sessions and recovery codes with them', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())
  await store.createSession({
    tokenHash: 't1',
    adminId: created.id,
    mfaVerified: true,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  })
  await store.replaceRecoveryCodes(created.id, ['h1', 'h2'])

  assert.equal(await store.deleteAdmin(created.id), true)
  assert.equal(await store.findSession('t1'), null)
  assert.equal(await store.countRecoveryCodes(created.id), 0)
  // Deleting again is a no-op, not an error.
  assert.equal(await store.deleteAdmin(created.id), false)
})

// --- sessions -------------------------------------------------------------------

test('revoking sessions can spare the one asking', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())
  const expiresAt = new Date(Date.now() + 3600_000).toISOString()
  for (const tokenHash of ['desktop', 'laptop', 'phone']) {
    await store.createSession({ tokenHash, adminId: created.id, mfaVerified: true, expiresAt })
  }

  // Changing your own password should not sign you out of the tab you are in.
  await store.revokeSessionsFor(created.id, { except: 'desktop' })
  assert.equal((await store.findSession('desktop')).revokedAt, null)
  assert.ok((await store.findSession('laptop')).revokedAt)
  assert.ok((await store.findSession('phone')).revokedAt)
})

test('revoking touches only that admin’s sessions', async () => {
  const store = createMemoryAdminStore()
  const mine = await store.createAdmin(admin())
  const theirs = await store.createAdmin(admin({ email: 'other@example.com' }))
  const expiresAt = new Date(Date.now() + 3600_000).toISOString()
  await store.createSession({ tokenHash: 'mine', adminId: mine.id, mfaVerified: true, expiresAt })
  await store.createSession({ tokenHash: 'theirs', adminId: theirs.id, mfaVerified: true, expiresAt })

  await store.revokeSessionsFor(mine.id)
  assert.ok((await store.findSession('mine')).revokedAt)
  assert.equal((await store.findSession('theirs')).revokedAt, null)
})

test('the sweeper removes only expired sessions', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())
  await store.createSession({
    tokenHash: 'stale',
    adminId: created.id,
    mfaVerified: true,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  })
  await store.createSession({
    tokenHash: 'fresh',
    adminId: created.id,
    mfaVerified: true,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  })

  assert.equal(await store.sweepSessions(), 1)
  assert.equal(await store.findSession('stale'), null)
  assert.ok(await store.findSession('fresh'))
})

// --- recovery codes ----------------------------------------------------------------

test('a recovery code is consumed exactly once', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())
  await store.replaceRecoveryCodes(created.id, ['hash-a', 'hash-b'])

  assert.equal(await store.consumeRecoveryCode(created.id, 'hash-a'), true)
  assert.equal(await store.consumeRecoveryCode(created.id, 'hash-a'), false)
  assert.equal(await store.countRecoveryCodes(created.id), 1)
})

test('one admin’s recovery code does not work for another', async () => {
  const store = createMemoryAdminStore()
  const mine = await store.createAdmin(admin())
  const theirs = await store.createAdmin(admin({ email: 'other@example.com' }))
  await store.replaceRecoveryCodes(mine.id, ['shared-looking-hash'])

  assert.equal(await store.consumeRecoveryCode(theirs.id, 'shared-looking-hash'), false)
  assert.equal(await store.countRecoveryCodes(mine.id), 1)
})

test('regenerating codes invalidates the old ones', async () => {
  const store = createMemoryAdminStore()
  const created = await store.createAdmin(admin())
  await store.replaceRecoveryCodes(created.id, ['old-1', 'old-2'])
  await store.replaceRecoveryCodes(created.id, ['new-1'])

  assert.equal(await store.consumeRecoveryCode(created.id, 'old-1'), false)
  assert.equal(await store.consumeRecoveryCode(created.id, 'new-1'), true)
})

// --- the file backing ---------------------------------------------------------------

test('the file store survives a restart', async () => {
  const dir = tempDir('asknelson-store-')
  const file = path.join(dir, 'admin-accounts.json')

  const first = createFileAdminStore(file)
  const created = await first.createAdmin(admin())
  await first.createSession({
    tokenHash: 'session-token',
    adminId: created.id,
    mfaVerified: true,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  })
  await first.replaceRecoveryCodes(created.id, ['hash-a'])

  // A restart must not sign every admin out, nor lose their second factor.
  const second = createFileAdminStore(file)
  assert.equal(await second.countAdmins(), 1)
  assert.ok(await second.findAdminByEmail('sam@example.com'))
  assert.ok(await second.findSession('session-token'))
  assert.equal(await second.countRecoveryCodes(created.id), 1)
})

test('the account file is not world-readable', async () => {
  const dir = tempDir('asknelson-store-')
  const file = path.join(dir, 'admin-accounts.json')
  const store = createFileAdminStore(file)
  await store.createAdmin(admin())

  assert.ok(fs.existsSync(file))
  if (process.platform !== 'win32') {
    // It holds password hashes and TOTP secrets.
    assert.equal(fs.statSync(file).mode & 0o077, 0)
  }
})

test('a corrupt account file fails loudly rather than starting empty', async () => {
  // Silently starting with no admins would look exactly like a fresh install,
  // and bootstrap would then hand ownership to whatever is in the environment.
  const dir = tempDir('asknelson-store-')
  const file = path.join(dir, 'admin-accounts.json')
  fs.writeFileSync(file, '{ not json')
  assert.throws(() => createFileAdminStore(file), /unreadable/)
})

test('a missing account file is a fresh start, not an error', () => {
  const dir = tempDir('asknelson-store-')
  const store = createFileAdminStore(path.join(dir, 'nested', 'admin-accounts.json'))
  assert.ok(store)
})
