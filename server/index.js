// First, so .env is in place before any module below reads its settings.
import './loadEnv.js'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isEnabled as analyticsEnabled,
  migrate,
  pool,
  query,
  sweepExpiredAdminSessions,
  sweepRetention,
} from './db.js'
import { encryptionConfigured } from './crypto.js'
import { createAnalyticsRouter, startSessionSweeper } from './analytics.js'
import { createAuthRouter, startAuthSweeper } from './auth.js'
import { createProgressRouter } from './progress.js'
import { createEmbedRouter } from './embed.js'
import { createReaderRouter } from './reader.js'
import { isSecure } from './http.js'
import {
  createAdminAuthRouter,
  createAdminSessionMiddleware,
  createAdminUsersRouter,
  ensureBootstrapAdmin,
} from './adminAuth.js'
import { createFileAdminStore, createPostgresAdminStore } from './adminStore.js'
import { requirePermission } from './rbac.js'
import { DATASETS, createContentRouter } from './contentRoutes.js'
import { createUploadRouter } from './uploadRoutes.js'
import { MAX_UPLOAD_BYTES, formatBytes } from './images.js'
import { audit } from './audit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const PORT = Number(process.env.PORT || 8080)
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data-store')
const SEED_DIR = process.env.SEED_DIR || path.join(ROOT, 'src', 'data')
const DIST_DIR = process.env.DIST_DIR || path.join(ROOT, 'dist')

// Uploaded imagery (journey covers, theme art) lives inside DATA_DIR so it sits
// on the same persistent volume as the JSON that references it — back one up
// and you have backed up the other.
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')

// First boot: copy the JSON bundled with the app into the writable data
// directory, so the admin portal has something to edit and the app has
// something to serve.
function seedIfMissing() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  for (const key of Object.keys(DATASETS)) {
    const target = path.join(DATA_DIR, `${key}.json`)
    if (fs.existsSync(target)) continue
    const seed = path.join(SEED_DIR, `${key}.json`)
    if (fs.existsSync(seed)) {
      fs.copyFileSync(seed, target)
      console.log(`[asknelson] seeded ${key}.json into ${DATA_DIR}`)
    } else {
      console.warn(`[asknelson] no seed found for ${key} at ${seed}`)
    }
  }
}

// Every host the content links to — the only sites the embed checker will
// contact. Recomputed at most once a minute so admin edits are picked up.
// EMBED_EXTRA_HOSTS covers links that live in code rather than content (the
// Kaelo booking form on the AskNelson tab).
const EMBED_EXTRA_HOSTS = (process.env.EMBED_EXTRA_HOSTS ?? 'www.kaelo.co.za')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean)
let hostCache = { at: 0, hosts: new Set() }

function collectHosts(node, hosts) {
  if (typeof node === 'string') {
    if (node.startsWith('https://')) {
      try {
        hosts.add(new URL(node).hostname)
      } catch {
        /* not a URL after all */
      }
    }
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectHosts(value, hosts)
  }
}

// contentHosts reads the datasets straight off disk rather than through the
// content router: it only wants the URLs, drafts included.
function readDataset(key) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${key}.json`), 'utf8'))
}

function contentHosts() {
  if (Date.now() - hostCache.at < 60_000) return hostCache.hosts
  const hosts = new Set(EMBED_EXTRA_HOSTS)
  for (const key of Object.keys(DATASETS)) {
    try {
      collectHosts(readDataset(key), hosts)
    } catch {
      /* a missing dataset just contributes nothing */
    }
  }
  hostCache = { at: Date.now(), hosts }
  return hosts
}

// --- app ----------------------------------------------------------------------

seedIfMissing()

// Admin accounts live in Postgres where there is one, and in a 0600 JSON file
// next to the content otherwise — the portal still has to work in the
// no-database mode, which is how the content editor is run locally.
const adminStore = analyticsEnabled
  ? createPostgresAdminStore({ query })
  : createFileAdminStore(path.join(DATA_DIR, 'admin-accounts.json'))

const app = express()
app.disable('x-powered-by')
// Behind a load balancer or ingress: needed for correct req.ip (analytics rate
// limiting) and req.secure (the Secure flag on the device cookie).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))

// Encryption in transit (POPIA s19). TLS itself terminates at the load
// balancer or ingress in front of this process; these make sure nothing
// travels over plain HTTP once a browser has seen the HTTPS site.
const FORCE_HTTPS = process.env.FORCE_HTTPS === 'true'
app.use((req, res, next) => {
  if (FORCE_HTTPS && !isSecure(req) && req.path !== '/api/health') {
    return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`)
  }
  if (isSecure(req)) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.set('X-Content-Type-Options', 'nosniff')
  // Never send a full in-app URL (which can name a journey or assessment) to
  // the external sites members open.
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // Other sites may not frame AskNelson (clickjacking on sign-in).
  res.set('X-Frame-Options', 'SAMEORIGIN')
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})

app.use(express.json({ limit: '5mb' }))

// Resolves the admin session cookie onto req.admin for everything below. It
// never rejects on its own — requirePermission() decides what an
// unauthenticated or half-authenticated (password but no second factor)
// request may do.
app.use(createAdminSessionMiddleware({ store: adminStore }))

// Admin sign-in, second factor and account management.
app.use('/api/admin/auth', createAdminAuthRouter({ store: adminStore, audit }))
app.use('/api/admin/users', createAdminUsersRouter({ store: adminStore, audit }))

// Event tracking. Mounted before the static handler so /api wins, and a no-op
// when DATABASE_URL is unset.
app.use('/api/analytics', createAnalyticsRouter({ requirePermission }))

// Accounts, OTP verification and sessions. Also requires a database; the app
// stays fully browsable without one, it just can't offer sign-in.
app.use('/api/auth', createAuthRouter())

// Journey, assessment, meditation and reading progress for signed-in members,
// so they can continue where they left off on any device.
app.use('/api/progress', createProgressRouter())

// Whether an external article can be shown inside the in-app viewer.
app.use('/api/embed', createEmbedRouter({ allowedHosts: contentHosts }))

// Reader view: the article itself, extracted and sanitised, for publishers
// that refuse to be framed.
app.use('/api/reader', createReaderRouter({ allowedHosts: contentHosts }))

// Content: read by the PWA (published items only), written from the admin
// portal. Editing needs content:write; changing what members can see needs
// content:publish as well — see server/contentRoutes.js.
app.use('/api/content', createContentRouter({ dataDir: DATA_DIR, seedDir: SEED_DIR, audit }))

// Public read of uploaded media: the PWA renders these straight from <img
// src>. Filenames carry a content hash, so a long immutable cache is safe.
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    immutable: true,
    index: false,
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  })
)

// The media library behind the admin editor's image fields.
app.use('/api/admin/uploads', createUploadRouter({ uploadDir: UPLOAD_DIR, audit }))

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, analytics: analyticsEnabled, encryption: encryptionConfigured })
)

// An oversized upload arrives as a PayloadTooLargeError from express.raw
// rather than as a rejected request, so turn it into the same message the
// size check gives.
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({
      error: `That file is too large — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    })
  }
  return next(err)
})

// --- static frontend ------------------------------------------------------------

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // SPA fallback: any non-API GET serves index.html so client-side routes
  // (/explore, /admin, ...) work on hard refresh. /uploads is excluded so a
  // deleted or mistyped image 404s honestly instead of returning HTML with a
  // 200, which would defeat the <img> onError fallback on the cards.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next()
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
} else {
  console.warn(`[asknelson] no dist/ build found at ${DIST_DIR} — API-only mode`)
}

// Run migrations before accepting traffic, so the first request can never hit a
// half-built schema. A database that is configured but unreachable is fatal —
// failing loudly beats silently dropping every event.
if (analyticsEnabled) {
  // Personal information is sealed before it reaches Postgres. Refusing to
  // start beats silently writing plaintext, or writing data nobody can read.
  if (!encryptionConfigured) {
    console.error(
      '[asknelson] FATAL: DATABASE_URL is set but DATA_ENCRYPTION_KEYS is not. ' +
        'Generate a key with `npm run keys:generate` and set it (see .env.example).'
    )
    process.exit(1)
  }
  try {
    await migrate()
    startSessionSweeper()
    startAuthSweeper()
    // Daily, plus once now: raw analytics and audit rows past their
    // retention window are deleted (POPIA s14), and expired admin sessions
    // are dropped rather than left to accumulate.
    const sweep = () =>
      Promise.all([sweepRetention(), sweepExpiredAdminSessions()]).catch((err) =>
        console.error('[asknelson] retention sweep failed:', err.message)
      )
    sweep()
    setInterval(sweep, 24 * 60 * 60 * 1000).unref()
    console.log('[asknelson] analytics + accounts enabled — schema up to date, encryption on')
  } catch (err) {
    // Log the whole error, not just .message — a refused connection surfaces as
    // an AggregateError whose message is empty, which tells an operator nothing.
    console.error('[asknelson] FATAL: analytics migration failed:', err)
    process.exit(1)
  }
} else {
  console.log('[asknelson] analytics disabled — set DATABASE_URL to enable event tracking')
  if (!encryptionConfigured) {
    console.warn(
      '[asknelson] WARNING: DATA_ENCRYPTION_KEYS is not set — admin emails and ' +
        'two-factor secrets are stored in the clear in the account file. ' +
        'Generate a key with `npm run keys:generate` before using this anywhere real.'
    )
  }
}

// The first owner, from the environment, and only ever into an empty account
// store — this cannot be used to re-take an installation that already has
// admins. The account starts with no second factor, so its first sign-in has
// to enrol one before it can do anything.
const bootstrap = await ensureBootstrapAdmin(adminStore, {
  email: process.env.ADMIN_BOOTSTRAP_EMAIL,
  password: process.env.ADMIN_PASSWORD,
})
if (bootstrap.created) {
  console.log(`[asknelson] created the first admin account: ${bootstrap.email} (owner)`)
  console.log('[asknelson] its first sign-in must enrol two-factor authentication')
} else if (bootstrap.reason === 'not-configured' && (await adminStore.countAdmins()) === 0) {
  console.warn(
    '[asknelson] WARNING: no admin accounts exist and ADMIN_BOOTSTRAP_EMAIL / ADMIN_PASSWORD ' +
      'are not both set — nobody can sign in to /admin. See .env.example.'
  )
}

const server = app.listen(PORT, () => {
  console.log(`[asknelson] listening on http://localhost:${PORT}`)
  console.log(`[asknelson] data dir: ${DATA_DIR}`)
})

// Close the pool on the way out so a rolling deploy doesn't leave the database
// holding connections for a process that has already gone.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => {
      pool?.end().catch(() => {})
    })
  })
}
