import test from 'node:test'
import assert from 'node:assert/strict'
import { generateSecret, totp } from '../server/totp.js'
import { startTestServer } from './helpers/testServer.js'

// Publishing over HTTP, with the roles that meet there.
//
// The rule being proved: an editor can change the words of live content, and
// cannot change what members see — including by burying a visibility change
// inside an otherwise ordinary save, which is the obvious way to try.

const content = () => ({
  explore: {
    explore: {
      themes: [
        {
          id: 'anxiety',
          title: 'Anxiety',
          content: [
            { id: 'ax-01', title: 'Live tile' },
            { id: 'ax-02', title: 'Draft tile', published: false },
          ],
        },
        { id: 'sleep', title: 'Sleep', published: false, content: [] },
      ],
    },
  },
})

const ROLES = ['analyst', 'editor', 'publisher', 'admin', 'owner']

async function serverWithRoles() {
  const secrets = Object.fromEntries(ROLES.map((role) => [role, generateSecret()]))
  const server = await startTestServer({
    admins: ROLES.map((role) => ({
      email: `${role}@example.com`,
      password: 'a-good-long-password',
      role,
      totpSecret: secrets[role],
    })),
    content: content(),
  })
  return { server, secrets }
}

/** Sign in as one role. Each gets its own step, so no code is ever reused. */
async function as(server, secrets, role, stepOffset = 0) {
  const client = server.client()
  const login = await client.request('/api/admin/auth/login', {
    method: 'POST',
    body: { email: `${role}@example.com`, password: 'a-good-long-password' },
  })
  assert.equal(login.status, 200, login.text)
  const mfa = await client.request('/api/admin/auth/mfa', {
    method: 'POST',
    body: { code: totp(secrets[role], { timeMs: Date.now() + stepOffset * 30_000 }) },
  })
  assert.equal(mfa.status, 200, mfa.text)
  return client
}

test('the public read serves only published content', async () => {
  const { server } = await serverWithRoles()
  const anonymous = server.client()

  const res = await anonymous.request('/api/content/explore')
  assert.equal(res.status, 200)
  assert.deepEqual(
    res.body.explore.themes.map((t) => t.id),
    ['anxiety']
  )
  assert.deepEqual(
    res.body.explore.themes[0].content.map((c) => c.id),
    ['ax-01']
  )
  // The flag itself is not shipped: the app never learns what is held back.
  assert.equal(res.text.includes('published'), false)

  await server.close()
})

test('drafts are not readable without signing in', async () => {
  const { server } = await serverWithRoles()
  const res = await server.client().request('/api/content/explore?include=drafts')
  assert.equal(res.status, 403)
  await server.close()
})

test('an admin sees drafts, with their publishing state', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const res = await client.request('/api/content/explore?include=drafts')
  assert.equal(res.status, 200)
  assert.equal(res.body.explore.themes.length, 2)
  assert.ok(res.body._publishing.some((i) => i.ref === 'theme:sleep' && i.published === false))

  await server.close()
})

test('an editor can save an edit to live content', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const doc = content().explore
  doc.explore.themes[0].content[0].title = 'Corrected headline'

  const res = await client.request('/api/content/explore', { method: 'PUT', body: doc })
  assert.equal(res.status, 200, res.text)
  assert.deepEqual(res.body.publishChanges, [])
  assert.equal(server.readDataset('explore').explore.themes[0].content[0].title, 'Corrected headline')

  await server.close()
})

test('an editor cannot publish a draft through a save', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const doc = content().explore
  doc.explore.themes[1].published = true

  const res = await client.request('/api/content/explore', { method: 'PUT', body: doc })
  assert.equal(res.status, 403)
  assert.equal(res.body.required, 'content:publish')
  // The response says exactly what was refused, so the editor can undo it.
  assert.deepEqual(
    res.body.publishChanges.map((c) => [c.ref, c.change]),
    [['theme:sleep', 'published']]
  )
  // And nothing was written.
  assert.equal(server.readDataset('explore').explore.themes[1].published, false)

  await server.close()
})

test('an editor cannot delete live content through a save', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const doc = content().explore
  doc.explore.themes[0].content.splice(0, 1)

  const res = await client.request('/api/content/explore', { method: 'PUT', body: doc })
  assert.equal(res.status, 403)
  assert.equal(server.readDataset('explore').explore.themes[0].content.length, 2)

  await server.close()
})

test('a publisher can do both', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'publisher')

  const doc = content().explore
  doc.explore.themes[1].published = true
  doc.explore.themes[0].title = 'Anxiety & Stress'

  const res = await client.request('/api/content/explore', { method: 'PUT', body: doc })
  assert.equal(res.status, 200, res.text)
  assert.equal(res.body.publishChanges.length, 1)

  const saved = server.readDataset('explore')
  assert.equal(saved.explore.themes[1].published, true)
  assert.equal(saved.explore.themes[0].title, 'Anxiety & Stress')

  await server.close()
})

test('an analyst cannot write content at all', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'analyst')

  const res = await client.request('/api/content/explore', { method: 'PUT', body: content().explore })
  assert.equal(res.status, 403)
  assert.equal(res.body.required, 'content:write')

  await server.close()
})

// --- the dedicated publish endpoint -------------------------------------------

test('a publisher can publish and unpublish one item', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'publisher')

  const published = await client.request('/api/content/explore/publish', {
    method: 'POST',
    body: { ref: 'theme:sleep', published: true },
  })
  assert.equal(published.status, 200, published.text)
  assert.equal(server.readDataset('explore').explore.themes[1].published, true)
  // And it now reaches the app.
  const live = await server.client().request('/api/content/explore')
  assert.equal(live.body.explore.themes.length, 2)

  const pulled = await client.request('/api/content/explore/publish', {
    method: 'POST',
    body: { ref: 'theme:anxiety', published: false },
  })
  assert.equal(pulled.status, 200)
  const after = await server.client().request('/api/content/explore')
  assert.deepEqual(
    after.body.explore.themes.map((t) => t.id),
    ['sleep']
  )

  await server.close()
})

test('a nested tile publishes on its own', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'publisher')

  const res = await client.request('/api/content/explore/publish', {
    method: 'POST',
    body: { ref: 'theme:anxiety/tile:ax-02', published: true },
  })
  assert.equal(res.status, 200, res.text)

  const live = await server.client().request('/api/content/explore')
  assert.deepEqual(
    live.body.explore.themes[0].content.map((c) => c.id),
    ['ax-01', 'ax-02']
  )

  await server.close()
})

test('an editor cannot use the publish endpoint', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'editor')

  const res = await client.request('/api/content/explore/publish', {
    method: 'POST',
    body: { ref: 'theme:sleep', published: true },
  })
  assert.equal(res.status, 403)
  assert.equal(server.readDataset('explore').explore.themes[1].published, false)

  await server.close()
})

test('publishing rejects a ref that matches nothing', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'publisher')

  assert.equal(
    (
      await client.request('/api/content/explore/publish', {
        method: 'POST',
        body: { ref: 'theme:does-not-exist', published: true },
      })
    ).status,
    404
  )
  assert.equal(
    (await client.request('/api/content/explore/publish', { method: 'POST', body: { published: true } }))
      .status,
    400
  )

  await server.close()
})

test('publishing is written to the audit trail', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'publisher')

  await client.request('/api/content/explore/publish', {
    method: 'POST',
    body: { ref: 'theme:sleep', published: true },
  })
  const entry = server.audited.find((e) => e.action === 'content_published')
  assert.ok(entry, 'no content_published audit entry')
  assert.equal(entry.targetId, 'theme:sleep')
  assert.equal(entry.details.dataset, 'explore')

  await server.close()
})

// --- other guards -----------------------------------------------------------------

test('an unknown dataset is a 404, whatever the method', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'owner')

  assert.equal((await server.client().request('/api/content/nope')).status, 404)
  assert.equal(
    (await client.request('/api/content/nope', { method: 'PUT', body: { nope: [] } })).status,
    404
  )

  await server.close()
})

test('a payload of the wrong shape is refused', async () => {
  const { server, secrets } = await serverWithRoles()
  const client = await as(server, secrets, 'owner')

  for (const body of [{ explore: [] }, { explore: { themes: 'nope' } }, {}]) {
    const res = await client.request('/api/content/explore', { method: 'PUT', body })
    assert.equal(res.status, 400, JSON.stringify(body))
  }
  // And the stored dataset is intact.
  assert.equal(server.readDataset('explore').explore.themes.length, 2)

  await server.close()
})

test('resetting to the shipped content needs the publish permission', async () => {
  const { server, secrets } = await serverWithRoles()

  const editor = await as(server, secrets, 'editor')
  assert.equal((await editor.request('/api/content/explore/reset', { method: 'POST' })).status, 403)

  // A reset republishes everything in the seed, so it is a publishing act.
  const publisher = await as(server, secrets, 'publisher')
  const res = await publisher.request('/api/content/explore/reset', { method: 'POST' })
  assert.equal(res.status, 200, res.text)

  await server.close()
})
