import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEnabled as analyticsEnabled, migrate, sweepRetention } from './db.js'
import { encryptionConfigured } from './crypto.js'
import { createAnalyticsRouter, startSessionSweeper } from './analytics.js'
import { createAuthRouter, startAuthSweeper } from './auth.js'
import { createProgressRouter } from './progress.js'
import { createEmbedRouter } from './embed.js'
import { isSecure } from './http.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const PORT = Number(process.env.PORT || 8080)
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data-store')
const SEED_DIR = process.env.SEED_DIR || path.join(ROOT, 'src', 'data')
const DIST_DIR = process.env.DIST_DIR || path.join(ROOT, 'dist')
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'

// Uploaded imagery (journey covers, theme art) lives inside DATA_DIR so it sits
// on the same persistent volume as the JSON that references it — back one up
// and you have backed up the other.
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    '[asknelson] WARNING: ADMIN_PASSWORD is not set — using the default "admin". ' +
      'Set ADMIN_PASSWORD before exposing this server anywhere.'
  )
}

// The three editable datasets. Each maps to <DATA_DIR>/<key>.json, seeded from
// the JSON bundled with the app on first boot. `rootKey` is the required
// top-level property, used as a light sanity check on writes.
const DATASETS = {
  explore: { rootKey: 'explore' },
  journeys: { rootKey: 'journeys' },
  assessments: { rootKey: 'assessments' },
}

// --- storage ----------------------------------------------------------------

function dataPath(key) {
  return path.join(DATA_DIR, `${key}.json`)
}

function seedIfMissing() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  for (const key of Object.keys(DATASETS)) {
    const target = dataPath(key)
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

function readDataset(key) {
  return JSON.parse(fs.readFileSync(dataPath(key), 'utf8'))
}

// Atomic write: write to a temp file in the same directory, then rename over
// the target, so a crash mid-write never leaves a corrupt dataset behind.
function writeDataset(key, value) {
  const target = dataPath(key)
  const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, target)
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

// --- uploads ------------------------------------------------------------------

// Raster formats only. SVG is deliberately excluded: it can carry script, and
// these files are served from the app's own origin.
const IMAGE_TYPES = [
  { ext: 'png', mime: 'image/png', match: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', match: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', match: (b) => b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8' },
  {
    ext: 'webp',
    mime: 'image/webp',
    match: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
]

// Trust the bytes, not the Content-Type header a client claims.
function sniffImage(buf) {
  return IMAGE_TYPES.find((t) => t.match(buf)) || null
}

// Keep a readable slug of the original filename so the media library is
// browsable, and suffix a content hash so re-uploading the same file is a
// no-op rather than a duplicate.
function uploadFilename(originalName, buf, ext) {
  const base =
    path
      .basename(String(originalName || 'image'), path.extname(String(originalName || '')))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8)
  return `${base}-${hash}.${ext}`
}

// Guard against `..` and nested paths in user-supplied names.
function resolveUpload(name) {
  const safe = path.basename(String(name || ''))
  if (!safe || safe.startsWith('.')) return null
  const full = path.join(UPLOAD_DIR, safe)
  if (path.dirname(full) !== UPLOAD_DIR) return null
  return { name: safe, full }
}

function listUploads() {
  if (!fs.existsSync(UPLOAD_DIR)) return []
  return fs
    .readdirSync(UPLOAD_DIR)
    .filter((name) => IMAGE_TYPES.some((t) => name.toLowerCase().endsWith(`.${t.ext}`)))
    .map((name) => {
      const stat = fs.statSync(path.join(UPLOAD_DIR, name))
      return { name, url: `/uploads/${name}`, size: stat.size, modified: stat.mtimeMs }
    })
    .sort((a, b) => b.modified - a.modified)
}

// --- auth ---------------------------------------------------------------------

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || !safeEqual(token, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// --- app ----------------------------------------------------------------------

seedIfMissing()

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

// Event tracking. Mounted before the static handler so /api wins, and a no-op
// when DATABASE_URL is unset.
app.use('/api/analytics', createAnalyticsRouter({ requireAdmin }))

// Accounts, OTP verification and sessions. Also requires a database; the app
// stays fully browsable without one, it just can't offer sign-in.
app.use('/api/auth', createAuthRouter())

// Journey, assessment, meditation and reading progress for signed-in members,
// so they can continue where they left off on any device.
app.use('/api/progress', createProgressRouter())

// Whether an external article can be shown inside the in-app viewer.
app.use('/api/embed', createEmbedRouter({ allowedHosts: contentHosts }))

// Content is fetched by the PWA; keep it out of the HTTP cache so edits show up
// on the next load (the service worker applies its own NetworkFirst strategy).
app.get('/api/content/:key', (req, res) => {
  const { key } = req.params
  if (!DATASETS[key]) return res.status(404).json({ error: 'Unknown dataset' })
  try {
    res.set('Cache-Control', 'no-store')
    res.json(readDataset(key))
  } catch (err) {
    console.error(`[asknelson] failed to read ${key}:`, err)
    res.status(500).json({ error: 'Failed to read dataset' })
  }
})

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {}
  if (!password || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Wrong password' })
  }
  res.json({ ok: true })
})

app.put('/api/content/:key', requireAdmin, (req, res) => {
  const { key } = req.params
  const dataset = DATASETS[key]
  if (!dataset) return res.status(404).json({ error: 'Unknown dataset' })

  const body = req.body
  const root = body?.[dataset.rootKey]
  // Light shape check: the top-level key must exist and hold the expected
  // container (explore -> object with themes[], others -> array).
  const validShape =
    key === 'explore' ? Array.isArray(root?.themes) : Array.isArray(root)
  if (!validShape) {
    return res.status(400).json({
      error: `Invalid payload: expected a top-level "${dataset.rootKey}" ${
        key === 'explore' ? 'object with a themes array' : 'array'
      }.`,
    })
  }

  try {
    writeDataset(key, body)
    res.json({ ok: true })
  } catch (err) {
    console.error(`[asknelson] failed to write ${key}:`, err)
    res.status(500).json({ error: 'Failed to save dataset' })
  }
})

// Reset a dataset back to the JSON shipped with the app.
app.post('/api/content/:key/reset', requireAdmin, (req, res) => {
  const { key } = req.params
  if (!DATASETS[key]) return res.status(404).json({ error: 'Unknown dataset' })
  const seed = path.join(SEED_DIR, `${key}.json`)
  try {
    const value = JSON.parse(fs.readFileSync(seed, 'utf8'))
    writeDataset(key, value)
    res.json({ ok: true, data: value })
  } catch (err) {
    console.error(`[asknelson] failed to reset ${key}:`, err)
    res.status(500).json({ error: 'Failed to reset dataset' })
  }
})

// --- uploaded media -----------------------------------------------------------

// Public read: the PWA renders these straight from <img src>. Filenames carry a
// content hash, so a long immutable cache is safe.
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    immutable: true,
    index: false,
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  })
)

app.get('/api/admin/uploads', requireAdmin, (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store')
    res.json({ uploads: listUploads() })
  } catch (err) {
    console.error('[asknelson] failed to list uploads:', err)
    res.status(500).json({ error: 'Failed to list uploads' })
  }
})

// The image arrives as a raw body rather than multipart, which keeps the
// server dependency-free; the original filename rides along as ?name=.
app.post(
  '/api/admin/uploads',
  requireAdmin,
  express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
  (req, res) => {
    const buf = req.body
    if (!Buffer.isBuffer(buf) || buf.length === 0) {
      return res.status(400).json({ error: 'Empty upload' })
    }
    const kind = sniffImage(buf)
    if (!kind) {
      return res
        .status(415)
        .json({ error: 'Unsupported file — use a PNG, JPG, WEBP or GIF image.' })
    }

    const name = uploadFilename(req.query.name, buf, kind.ext)
    const target = path.join(UPLOAD_DIR, name)
    try {
      // Same bytes, same name — an existing file is already correct, so skip
      // the rewrite and just hand back the URL.
      if (!fs.existsSync(target)) {
        const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`
        fs.writeFileSync(tmp, buf)
        fs.renameSync(tmp, target)
      }
      res.json({ ok: true, name, url: `/uploads/${name}`, size: buf.length })
    } catch (err) {
      console.error('[asknelson] failed to save upload:', err)
      res.status(500).json({ error: 'Failed to save upload' })
    }
  }
)

app.delete('/api/admin/uploads/:name', requireAdmin, (req, res) => {
  const resolved = resolveUpload(req.params.name)
  if (!resolved) return res.status(400).json({ error: 'Invalid filename' })
  try {
    if (!fs.existsSync(resolved.full)) return res.status(404).json({ error: 'Not found' })
    fs.unlinkSync(resolved.full)
    res.json({ ok: true })
  } catch (err) {
    console.error('[asknelson] failed to delete upload:', err)
    res.status(500).json({ error: 'Failed to delete upload' })
  }
})

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, analytics: analyticsEnabled, encryption: encryptionConfigured })
)

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
    // retention window are deleted (POPIA s14).
    const sweep = () =>
      sweepRetention().catch((err) => console.error('[asknelson] retention sweep failed:', err.message))
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
}

app.listen(PORT, () => {
  console.log(`[asknelson] listening on http://localhost:${PORT}`)
  console.log(`[asknelson] data dir: ${DATA_DIR}`)
})
