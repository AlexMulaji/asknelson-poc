import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const PORT = Number(process.env.PORT || 8080)
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data-store')
const SEED_DIR = process.env.SEED_DIR || path.join(ROOT, 'src', 'data')
const DIST_DIR = process.env.DIST_DIR || path.join(ROOT, 'dist')
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'

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
app.use(express.json({ limit: '5mb' }))

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

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// --- static frontend ------------------------------------------------------------

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // SPA fallback: any non-API GET serves index.html so client-side routes
  // (/explore, /admin, ...) work on hard refresh.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(DIST_DIR, 'index.html'))
  })
} else {
  console.warn(`[asknelson] no dist/ build found at ${DIST_DIR} — API-only mode`)
}

app.listen(PORT, () => {
  console.log(`[asknelson] listening on http://localhost:${PORT}`)
  console.log(`[asknelson] data dir: ${DATA_DIR}`)
})
