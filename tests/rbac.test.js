import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  ROLE_NAMES,
  can,
  canManage,
  isRole,
  permissionsFor,
  requirePermission,
  roleHas,
} from '../server/rbac.js'

const P = PERMISSIONS

/** A fake res that records the status and body a guard answered with. */
function fakeRes() {
  const res = { statusCode: null, payload: null }
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (payload) => {
    res.payload = payload
    return res
  }
  return res
}

function runGuard(permission, admin) {
  const res = fakeRes()
  let passed = false
  requirePermission(permission)({ admin }, res, () => {
    passed = true
  })
  return { passed, status: res.statusCode, body: res.payload }
}

const signedIn = (role, extra = {}) => ({
  id: 'a1',
  role,
  status: 'active',
  mfaVerified: true,
  ...extra,
})

test('every role grants only permissions that exist', () => {
  const known = new Set(Object.values(P))
  for (const [role, granted] of Object.entries(ROLES)) {
    for (const permission of granted) {
      assert.ok(known.has(permission), `${role} grants unknown permission "${permission}"`)
    }
    assert.equal(new Set(granted).size, granted.length, `${role} lists a permission twice`)
  }
})

test('owner holds every permission', () => {
  for (const permission of Object.values(P)) {
    assert.ok(roleHas('owner', permission), `owner is missing ${permission}`)
  }
})

test('every role has a label, and every label a role', () => {
  assert.deepEqual(Object.keys(ROLE_LABELS).sort(), [...ROLE_NAMES].sort())
})

test('publishing is separate from editing', () => {
  // The whole point of the split: an editor can write but cannot decide what
  // the member base sees.
  assert.ok(roleHas('editor', P.CONTENT_WRITE))
  assert.equal(roleHas('editor', P.CONTENT_PUBLISH), false)

  assert.ok(roleHas('publisher', P.CONTENT_WRITE))
  assert.ok(roleHas('publisher', P.CONTENT_PUBLISH))
})

test('only admin and owner can decrypt a member’s activity', () => {
  for (const role of ['analyst', 'editor', 'publisher']) {
    assert.equal(roleHas(role, P.ANALYTICS_READ_PII), false, `${role} should not read PII`)
  }
  for (const role of ['admin', 'owner']) {
    assert.ok(roleHas(role, P.ANALYTICS_READ_PII), `${role} should read PII`)
  }
})

test('only the owner can manage admin accounts', () => {
  for (const role of ['analyst', 'editor', 'publisher', 'admin']) {
    assert.equal(roleHas(role, P.ADMIN_MANAGE), false, `${role} should not manage admins`)
  }
  assert.ok(roleHas('owner', P.ADMIN_MANAGE))
})

test('an analyst cannot change content', () => {
  assert.ok(roleHas('analyst', P.CONTENT_READ))
  assert.equal(roleHas('analyst', P.CONTENT_WRITE), false)
  assert.equal(roleHas('analyst', P.MEDIA_WRITE), false)
})

test('an unknown role grants nothing rather than everything', () => {
  assert.deepEqual(permissionsFor('superuser'), [])
  assert.deepEqual(permissionsFor(undefined), [])
  assert.deepEqual(permissionsFor('__proto__'), [])
  assert.equal(isRole('constructor'), false)
  assert.equal(can(signedIn('superuser'), P.CONTENT_READ), false)
})

test('permissionsFor hands back a copy, not the live list', () => {
  const list = permissionsFor('editor')
  list.push(P.CONTENT_PUBLISH)
  assert.equal(roleHas('editor', P.CONTENT_PUBLISH), false)
})

test('a disabled account holds nothing', () => {
  assert.equal(can({ ...signedIn('owner'), status: 'disabled' }, P.CONTENT_READ), false)
})

test('a session that has not passed the second factor holds nothing', () => {
  // The crux of the two-step sign-in: the cookie is real, the password was
  // right, and it still cannot do anything.
  const halfway = signedIn('owner', { mfaVerified: false })
  for (const permission of Object.values(P)) {
    assert.equal(can(halfway, permission), false, `half-authenticated session got ${permission}`)
  }
})

test('the guard answers 401 when nobody is signed in', () => {
  const result = runGuard(P.CONTENT_READ, undefined)
  assert.equal(result.passed, false)
  assert.equal(result.status, 401)
})

test('the guard answers 401 with mfaRequired before the second factor', () => {
  const result = runGuard(P.CONTENT_READ, signedIn('owner', { mfaVerified: false }))
  assert.equal(result.passed, false)
  assert.equal(result.status, 401)
  // The client needs to tell "log in again" from "enter your code".
  assert.equal(result.body.mfaRequired, true)
})

test('the guard answers 403, naming the permission, when the role is wrong', () => {
  const result = runGuard(P.CONTENT_PUBLISH, signedIn('editor'))
  assert.equal(result.passed, false)
  assert.equal(result.status, 403)
  assert.equal(result.body.required, P.CONTENT_PUBLISH)
  assert.match(result.body.error, /editor/)
})

test('the guard passes a request that holds the permission', () => {
  assert.equal(runGuard(P.CONTENT_PUBLISH, signedIn('publisher')).passed, true)
})

// --- canManage ------------------------------------------------------------------

test('managing admins requires admin:manage', () => {
  assert.equal(canManage(signedIn('admin'), null, { role: 'editor' }).ok, false)
  assert.equal(canManage(signedIn('owner'), null, { role: 'editor' }).ok, true)
})

test('nobody can change their own role or status', () => {
  const owner = signedIn('owner')
  const self = { id: owner.id, role: 'owner' }
  assert.equal(canManage(owner, self, { role: 'editor' }).ok, false)
  assert.equal(canManage(owner, self, { status: 'disabled' }).ok, false)
  // Editing their own name is fine — it grants nothing.
  assert.equal(canManage(owner, self, { name: 'Sam' }).ok, true)
})

test('an owner account can only be changed by an owner', () => {
  // Nobody below owner holds admin:manage today, so this is belt and braces
  // for the day a role is added that does.
  const manager = signedIn('admin', { id: 'm1' })
  assert.equal(canManage(manager, { id: 'o1', role: 'owner' }, { role: 'editor' }).ok, false)
})

test('only an owner can grant the owner role', () => {
  const owner = signedIn('owner')
  assert.equal(canManage(owner, { id: 'x', role: 'editor' }, { role: 'owner' }).ok, true)
})

test('an unknown role cannot be assigned', () => {
  const verdict = canManage(signedIn('owner'), { id: 'x', role: 'editor' }, { role: 'wizard' })
  assert.equal(verdict.ok, false)
  assert.match(verdict.reason, /wizard/)
})
