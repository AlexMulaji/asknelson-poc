// Client-side event tracking.
//
// Three ids tie everything together:
//   device  — one per browser profile, minted here, kept in localStorage and
//             mirrored to a cookie by the server so either one surviving keeps
//             the device recognisable.
//   session — a visit; rolls over after 30 minutes of inactivity.
//   member  — resolved server-side from the opaque ?t=<token> on the WhatsApp
//             link, then bound to the device for good.
//
// Everything here is best-effort and non-blocking: with no backend (plain
// `vite dev`), offline, or in a browser with storage disabled, the app carries
// on and events are simply buffered or dropped. Tracking must never be able to
// break the member-facing experience.

const DEVICE_KEY = 'asknelson.analytics.device'
const SESSION_KEY = 'asknelson.analytics.session'
const QUEUE_KEY = 'asknelson.analytics.queue'
const TOKEN_KEY = 'asknelson.analytics.token'
const DEVICE_COOKIE = 'an_did'

const SESSION_IDLE_MS = 30 * 60 * 1000
const FLUSH_INTERVAL_MS = 5000
const FLUSH_AT_COUNT = 20
const MAX_QUEUE = 200 // hard cap so a long offline stretch can't fill storage

const state = {
  started: false,
  ready: false,
  disabled: false, // server has no DATABASE_URL — stop doing work
  opening: false, // a session request is in flight
  deviceId: null,
  sessionId: null,
  queue: [],
  seq: 0,
  flushTimer: null,
  inFlight: false,
  retryAt: 0,
  failures: 0,
}

// --- storage (never throws: Safari private mode, WhatsApp webviews, etc.) -----

function readStore(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota or privacy mode — ids fall back to the cookie / a fresh session */
  }
}

function readCookie(name) {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

function uuid() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID()
    // Non-secure origins (plain http) don't expose randomUUID.
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  } catch {
    return null
  }
}

// --- device / session ---------------------------------------------------------

function loadDeviceId() {
  const stored = readStore(DEVICE_KEY) || readCookie(DEVICE_COOKIE)
  if (stored) {
    writeStore(DEVICE_KEY, stored) // re-seed localStorage from the cookie
    return stored
  }
  const fresh = uuid()
  if (fresh) writeStore(DEVICE_KEY, fresh)
  return fresh
}

// Reuse the stored session while it is still warm; otherwise start a new one.
// Kept in localStorage rather than sessionStorage on purpose: a WhatsApp link
// tap can open a fresh tab, and we want that to continue the same visit.
function loadSession() {
  try {
    const raw = readStore(SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.id && Date.now() - (parsed.lastActivity || 0) < SESSION_IDLE_MS) {
        return { id: parsed.id, resumed: true }
      }
    }
  } catch {
    /* fall through to a new session */
  }
  return { id: uuid(), resumed: false }
}

function touchSession() {
  if (!state.sessionId) return
  writeStore(SESSION_KEY, JSON.stringify({ id: state.sessionId, lastActivity: Date.now() }))
}

function sessionIsStale() {
  try {
    const parsed = JSON.parse(readStore(SESSION_KEY) || 'null')
    return !parsed || Date.now() - (parsed.lastActivity || 0) >= SESSION_IDLE_MS
  } catch {
    return true
  }
}

// --- WhatsApp link token ------------------------------------------------------

// Pull ?t=<token> off the URL, remember it, and rewrite the address bar so the
// token never lands in a screenshot, a shared link, or a Referer header.
function captureToken() {
  let token = null
  try {
    const url = new URL(window.location.href)
    const found = url.searchParams.get('t')
    if (found) {
      token = found
      writeStore(TOKEN_KEY, found)
      url.searchParams.delete('t')
      const clean = url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '')
      window.history.replaceState({}, '', clean + url.hash)
    }
  } catch {
    /* ignore malformed URLs */
  }
  // A returning visit has no token in the URL; the stored one re-confirms the
  // link if the device row was ever lost.
  return token || readStore(TOKEN_KEY)
}

function captureUtm() {
  const utm = {}
  try {
    const params = new URLSearchParams(window.location.search)
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const value = params.get(key)
      if (value) utm[key.replace('utm_', '')] = value
    }
  } catch {
    /* ignore */
  }
  return utm
}

function displayMode() {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone'
    if (window.navigator.standalone) return 'standalone-ios'
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui'
  } catch {
    /* ignore */
  }
  return 'browser'
}

function buildContext() {
  const ua = navigator.userAgent || ''
  const utm = captureUtm()
  const isWhatsapp = /WhatsApp/i.test(ua) || utm.source === 'whatsapp'
  return {
    path: window.location.pathname,
    referrer: document.referrer || null,
    platform: navigator.platform || null,
    language: navigator.language || null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    screenW: window.screen?.width ?? null,
    screenH: window.screen?.height ?? null,
    displayMode: displayMode(),
    isWhatsapp,
    source: isWhatsapp ? 'whatsapp' : utm.source || (document.referrer ? 'referral' : 'direct'),
    utm,
  }
}

// --- queue --------------------------------------------------------------------

function loadQueue() {
  try {
    const parsed = JSON.parse(readStore(QUEUE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(-MAX_QUEUE) : []
  } catch {
    return []
  }
}

function persistQueue() {
  writeStore(QUEUE_KEY, JSON.stringify(state.queue.slice(-MAX_QUEUE)))
}

/**
 * Record an event. Safe to call before init, offline, or with tracking off.
 *
 * @param {string} name  e.g. 'content_opened'
 * @param {object} props small, flat metadata — no free text from the member,
 *                       and never assessment answers.
 */
export function track(name, props = {}) {
  if (state.disabled || !name) return

  // A tap after a long pause belongs to a new visit, not the old one.
  if (state.ready && sessionIsStale()) {
    startSession({ isNewVisit: true })
  }

  state.queue.push({
    uid: uuid(),
    // Stamped at track time, not flush time: an event queued during one visit
    // and only delivered on the next must still belong to the visit it happened
    // in. Sessions are never deleted server-side, so the old id stays valid.
    sid: state.sessionId,
    name,
    props,
    path: window.location.pathname,
    at: new Date().toISOString(),
    seq: state.seq++,
  })
  if (state.queue.length > MAX_QUEUE) state.queue = state.queue.slice(-MAX_QUEUE)
  persistQueue()
  touchSession()

  if (state.queue.length >= FLUSH_AT_COUNT) flush()
}

async function flush({ beacon = false } = {}) {
  if (state.disabled || !state.ready || state.inFlight) return
  if (state.queue.length === 0) return
  if (!navigator.onLine) return
  if (Date.now() < state.retryAt) return

  // One request per session: take the leading run of events sharing a session
  // id. Events are appended in order, so a run is always contiguous.
  const batchSid = state.queue[0].sid || state.sessionId
  let end = 0
  while (end < state.queue.length && end < 50 && (state.queue[end].sid || batchSid) === batchSid) {
    end += 1
  }
  const batch = state.queue.slice(0, end)
  const payload = JSON.stringify({
    deviceId: state.deviceId,
    sessionId: batchSid,
    events: batch,
  })

  // On pagehide a normal fetch is killed mid-flight; sendBeacon is the only
  // thing the browser guarantees to deliver. It is fire-and-forget, so we drop
  // the batch optimistically — event_uid makes a duplicate harmless if the app
  // is reopened and the same batch is retried.
  if (beacon && navigator.sendBeacon) {
    const ok = navigator.sendBeacon(
      '/api/analytics/events',
      new Blob([payload], { type: 'application/json' })
    )
    if (ok) {
      state.queue = state.queue.slice(batch.length)
      persistQueue()
    }
    return
  }

  state.inFlight = true
  try {
    const res = await fetch('/api/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })

    if (res.status === 204) {
      // Analytics is switched off server-side — stop and clear.
      state.disabled = true
      state.queue = []
      persistQueue()
      return
    }
    if (res.status === 409) {
      // The server doesn't know this session — the database was reset, or these
      // events outlived their session row. Retrying would loop forever, so drop
      // the batch and make sure a live session exists for what follows.
      state.queue = state.queue.slice(batch.length)
      persistQueue()
      if (batchSid === state.sessionId) {
        state.ready = false
        await startSession({ isNewVisit: true })
      }
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    state.queue = state.queue.slice(batch.length)
    state.failures = 0
    state.retryAt = 0
    persistQueue()
  } catch {
    // Exponential backoff, capped at a minute, so a backend outage doesn't turn
    // into a request storm from every open client.
    state.failures += 1
    state.retryAt = Date.now() + Math.min(1000 * 2 ** state.failures, 60_000)
  } finally {
    state.inFlight = false
  }
}

// --- bootstrap ----------------------------------------------------------------

async function startSession({ isNewVisit = false } = {}) {
  // The 5s timer, the online handler and a stale-session track() can all reach
  // here at once; without this they would race to open duplicate sessions.
  if (state.opening) return
  state.opening = true

  const token = captureToken()
  const session = isNewVisit ? { id: uuid(), resumed: false } : loadSession()

  state.deviceId = state.deviceId || loadDeviceId()
  state.sessionId = session.id
  // Hold off flushing until the server has acknowledged this session, or the
  // first batch would arrive before the session row exists and 409.
  state.ready = false

  if (!state.deviceId || !state.sessionId) {
    state.disabled = true // no crypto available; nothing sensible to do
    state.opening = false
    return
  }

  try {
    const res = await fetch('/api/analytics/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: state.deviceId,
        sessionId: state.sessionId,
        token,
        context: buildContext(),
      }),
    })

    if (res.status === 204) {
      state.disabled = true
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = await res.json()
    // The server may hand back a different device id — it found one in the
    // cookie that outranks ours. Adopt it so both stores agree.
    if (data.deviceId && data.deviceId !== state.deviceId) {
      state.deviceId = data.deviceId
      writeStore(DEVICE_KEY, data.deviceId)
    }
    if (data.sessionId) state.sessionId = data.sessionId

    state.ready = true
    state.failures = 0
    state.retryAt = 0
    touchSession()

    if (!session.resumed || isNewVisit) {
      track('session_start', {
        source: buildContext().source,
        display_mode: displayMode(),
        linked: Boolean(data.linked),
      })
    }
  } catch {
    // Offline or no backend: keep queueing. The online/visibility handlers and
    // the flush timer will retry.
    state.ready = false
  } finally {
    state.opening = false
  }

  // After the guard is released, so a 409 inside flush can re-open a session.
  if (state.ready) flush()
}

/**
 * Start tracking. Idempotent — safe under React StrictMode's double-invoke.
 */
export function initAnalytics() {
  if (state.started) return
  state.started = true
  state.queue = loadQueue()

  startSession()

  state.flushTimer = window.setInterval(() => {
    if (!state.ready && !state.disabled) startSession()
    else flush()
  }, FLUSH_INTERVAL_MS)

  // pagehide is the one event that fires reliably on mobile (including when the
  // WhatsApp webview is dismissed); visibilitychange covers tab switches.
  window.addEventListener('pagehide', () => {
    track('session_end', { reason: 'pagehide' })
    flush({ beacon: true })
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush({ beacon: true })
    else if (sessionIsStale()) startSession({ isNewVisit: true })
  })

  window.addEventListener('online', () => {
    state.retryAt = 0
    state.failures = 0
    track('connectivity_change', { online: true })
    if (!state.ready) startSession()
    else flush()
  })

  window.addEventListener('offline', () => {
    track('connectivity_change', { online: false })
  })

  // Fired when the PWA is added to the home screen — the clearest signal of
  // someone converting from a one-off WhatsApp tap into a returning user.
  window.addEventListener('appinstalled', () => {
    track('app_installed', {})
    flush()
  })
}

/**
 * Send whatever is queued right now, instead of waiting for the next tick.
 * For the handful of events worth seeing in near-real time (an SOS tap).
 */
export function flushNow() {
  flush()
}

/** Current ids — useful for support ("read me the code at the bottom"). */
export function getIds() {
  return { deviceId: state.deviceId, sessionId: state.sessionId, ready: state.ready }
}
