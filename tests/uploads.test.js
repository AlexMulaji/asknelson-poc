import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES } from '../server/images.js'
import { generateSecret, totp } from '../server/totp.js'
import { startTestServer } from './helpers/testServer.js'

// The media library over HTTP: who may upload, what is accepted, and what
// happens to a file that would stall a member on mobile data.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PNG = fs.readFileSync(path.join(ROOT, 'public/icons/icon-192.png'))

const ROLES = ['analyst', 'editor', 'publisher', 'owner']

async function serverWithRoles() {
  const secrets = Object.fromEntries(ROLES.map((role) => [role, generateSecret()]))
  const server = await startTestServer({
    admins: ROLES.map((role) => ({
      email: `${role}@example.com`,
      password: 'a-good-long-password',
      role,
      totpSecret: secrets[role],
    })),
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

const upload = (client, buf, name = 'photo.png', type = 'image/png') =>
  client.request(`/api/admin/uploads?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    raw: true,
    body: buf,
    headers: { 'Content-Type': type },
  })

test('the library is not readable without signing in', async () => {
  const { server } = await serverWithRoles()
  assert.equal((await server.client().request('/api/admin/uploads')).status, 401)
  assert.equal((await upload(server.client(), PNG)).status, 401)
  await server.close()
})

test('an editor can upload, and gets told the limits', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const res = await upload(client, PNG, 'Journey Cover.png')
  assert.equal(res.status, 200, res.text)
  assert.match(res.body.url, /^\/uploads\/journey-cover-[0-9a-f]{8}\.png$/)
  assert.deepEqual(res.body.dimensions, { width: 192, height: 192 })
  assert.ok(fs.existsSync(path.join(server.uploadDir, res.body.name)))

  const list = await client.request('/api/admin/uploads')
  assert.equal(list.body.uploads.length, 1)
  // Surfaced in the editor so nobody discovers the limits by being refused.
  assert.equal(list.body.limits.maxBytes, MAX_UPLOAD_BYTES)
  assert.equal(list.body.limits.maxDimension, MAX_IMAGE_DIMENSION)

  await server.close()
})

test('an analyst cannot upload', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'analyst')

  assert.equal((await client.request('/api/admin/uploads')).status, 403)
  assert.equal((await upload(client, PNG)).status, 403)

  await server.close()
})

test('re-uploading the same file does not duplicate it', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const first = await upload(client, PNG, 'cover.png')
  const again = await upload(client, PNG, 'cover.png')
  // The name carries a content hash, so identical bytes land on one file.
  assert.equal(first.body.name, again.body.name)
  assert.equal((await client.request('/api/admin/uploads')).body.uploads.length, 1)

  await server.close()
})

test('a file that is not an image is refused', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const res = await upload(client, Buffer.from('<svg onload="alert(1)"></svg>'), 'x.png', 'image/png')
  assert.equal(res.status, 415)
  // Declaring image/png does not make it one: the bytes decide.
  assert.equal(fs.readdirSync(server.uploadDir).length, 0)

  await server.close()
})

test('an oversized file is refused before it is written', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const huge = Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES + 1024)])
  const res = await upload(client, huge, 'huge.png')
  assert.equal(res.status, 413)
  assert.equal(fs.readdirSync(server.uploadDir).length, 0)

  await server.close()
})

test('an image with too many pixels is refused', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  // A camera JPEG's worth of pixels in a small file.
  const oversized = Buffer.from(PNG)
  oversized.writeUInt32BE(4032, 16)
  oversized.writeUInt32BE(3024, 20)

  const res = await upload(client, oversized, 'camera.png')
  assert.equal(res.status, 413)
  assert.match(res.body.error, /4032×3024/)

  await server.close()
})

test('an empty upload is refused', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')
  assert.equal((await upload(client, Buffer.alloc(0))).status, 400)
  await server.close()
})

test('deleting needs more than uploading does', async () => {
  const { server, secrets } = await serverWithRoles()
  const editor = await as(server, secrets, 'editor')
  const uploaded = await upload(editor, PNG, 'cover.png')

  // An editor can add to the library but not remove from it: a delete breaks
  // every piece of content still pointing at the file.
  const refused = await editor.request(`/api/admin/uploads/${uploaded.body.name}`, { method: 'DELETE' })
  assert.equal(refused.status, 403)
  assert.ok(fs.existsSync(path.join(server.uploadDir, uploaded.body.name)))

  const publisher = await as(server, secrets, 'publisher')
  const deleted = await publisher.request(`/api/admin/uploads/${uploaded.body.name}`, {
    method: 'DELETE',
  })
  assert.equal(deleted.status, 200)
  assert.equal(fs.existsSync(path.join(server.uploadDir, uploaded.body.name)), false)

  await server.close()
})

test('a delete cannot escape the upload directory', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'owner')

  const canary = path.join(server.dataDir, 'explore.json')
  fs.writeFileSync(canary, '{}')

  for (const name of ['..%2Fexplore.json', '%2E%2E%2Fexplore.json', '.%2E%2F.%2E%2Fpasswd']) {
    const res = await client.request(`/api/admin/uploads/${name}`, { method: 'DELETE' })
    assert.ok(res.status === 400 || res.status === 404, `${name} answered ${res.status}`)
  }
  assert.ok(fs.existsSync(canary), 'a traversal reached outside the upload directory')

  await server.close()
})

test('deleting is written to the audit trail', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'owner')
  const uploaded = await upload(client, PNG, 'cover.png')
  await client.request(`/api/admin/uploads/${uploaded.body.name}`, { method: 'DELETE' })

  const entry = server.audited.find((e) => e.action === 'media_deleted')
  assert.ok(entry)
  assert.equal(entry.targetId, uploaded.body.name)

  await server.close()
})
