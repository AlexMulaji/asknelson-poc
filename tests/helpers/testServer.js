import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { after } from 'node:test'
import {
  createAdminAuthRouter,
  createAdminSessionMiddleware,
  createAdminUsersRouter,
} from '../../server/adminAuth.js'
import { createMemoryAdminStore } from '../../server/adminStore.js'
import { createContentRouter } from '../../server/contentRoutes.js'
import { createUploadRouter } from '../../server/uploadRoutes.js'
import { hashPassword } from '../../server/passwords.js'

// A real HTTP server for the admin routes, with the account store in memory.
//
// The routers take their store as a parameter precisely so this is possible:
// the whole sign-in flow — lockouts, the half-authenticated session between
// password and second factor, session expiry, permission checks — is
// exercised over real requests with no database anywhere.

/** A fetch wrapper that keeps cookies, the way a browser does. */
export function createClient(baseUrl) {
  const jar = new Map()

  const cookieHeader = () =>
    [...jar].map(([name, value]) => `${name}=${value}`).join('; ')

  return {
    get cookies() {
      return new Map(jar)
    },
    clearCookies() {
      jar.clear()
    },
    async request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
          ...(jar.size ? { cookie: cookieHeader() } : {}),
          ...headers,
        },
        body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
      })

      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';')
        const eq = pair.indexOf('=')
        const name = pair.slice(0, eq).trim()
        const value = pair.slice(eq + 1).trim()
        // An empty value is how clearCookie() expires one.
        if (!value) jar.delete(name)
        else jar.set(name, value)
      }

      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        /* CSV and other non-JSON responses */
      }
      return { status: res.status, body: json, text, headers: res.headers }
    },
  }
}

/** A directory that cleans itself up when the test file finishes. */
export function tempDir(prefix = 'asknelson-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Stand up the admin API.
 *
 * @param {object} options
 * @param {Array}  [options.admins]  seed accounts as
 *                                   {email, password, role, totpSecret?, enrolled?}
 * @param {object} [options.content] datasets to write into the data dir
 * @param {Function} [options.now]   clock, so session expiry can be tested
 *                                   without waiting for it
 */
export async function startTestServer({ admins = [], content = null, now = () => new Date() } = {}) {
  const store = createMemoryAdminStore()
  const audited = []
  const audit = (_req, entry) => audited.push(entry)

  const created = {}
  for (const spec of admins) {
    const admin = await store.createAdmin({
      email: spec.email,
      name: spec.name ?? null,
      role: spec.role,
      status: spec.status ?? 'active',
      passwordHash: await hashPassword(spec.password),
    })
    if (spec.totpSecret) {
      await store.updateAdmin(admin.id, {
        totpSecret: spec.totpSecret,
        totpEnrolledAt: spec.enrolled === false ? null : new Date().toISOString(),
      })
    }
    created[spec.email] = await store.findAdminById(admin.id)
  }

  const dataDir = tempDir('asknelson-data-')
  const seedDir = tempDir('asknelson-seed-')
  const uploadDir = path.join(dataDir, 'uploads')
  fs.mkdirSync(uploadDir, { recursive: true })
  for (const [key, doc] of Object.entries(content ?? {})) {
    fs.writeFileSync(path.join(dataDir, `${key}.json`), JSON.stringify(doc, null, 2))
    fs.writeFileSync(path.join(seedDir, `${key}.json`), JSON.stringify(doc, null, 2))
  }

  const app = express()
  app.set('trust proxy', 1)
  app.use(createAdminSessionMiddleware({ store, now }))
  app.use('/api/admin/auth', createAdminAuthRouter({ store, audit, now }))
  app.use('/api/admin/users', createAdminUsersRouter({ store, audit, now }))
  app.use('/api/content', createContentRouter({ dataDir, seedDir, audit }))
  app.use('/api/admin/uploads', createUploadRouter({ uploadDir, audit }))

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`

  after(() => new Promise((resolve) => server.close(resolve)))

  return {
    store,
    admins: created,
    audited,
    dataDir,
    seedDir,
    uploadDir,
    baseUrl,
    client: () => createClient(baseUrl),
    readDataset: (key) => JSON.parse(fs.readFileSync(path.join(dataDir, `${key}.json`), 'utf8')),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** A minimal valid PNG of the given size, for upload tests. */
export function pngBytes(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrBody = Buffer.alloc(17)
  ihdrBody.write('IHDR', 0, 'latin1')
  ihdrBody.writeUInt32BE(width, 4)
  ihdrBody.writeUInt32BE(height, 8)
  ihdrBody[12] = 8 // bit depth
  ihdrBody[13] = 6 // colour type: RGBA
  const length = Buffer.alloc(4)
  length.writeUInt32BE(13)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crypto.createHash('sha256').update(ihdrBody).digest().readUInt32BE(0))
  return Buffer.concat([signature, length, ihdrBody, crc])
}

/** Pad a buffer out to `bytes`, keeping its header intact. */
export function padTo(buf, bytes) {
  return bytes <= buf.length ? buf : Buffer.concat([buf, Buffer.alloc(bytes - buf.length)])
}
