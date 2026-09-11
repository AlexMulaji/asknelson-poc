// Server-side progress, layered under the localStorage store.
//
// localStorage stays what the UI renders from — instant, offline, and exactly
// as before for signed-out visitors. When someone is signed in, every change is
// also sent to /api/progress through a small outbox (persisted, in order,
// retried when the connection comes back), and on sign-in the account's saved
// progress is merged into localStorage so it follows them to any device.
//
// Hooks listen for PROGRESS_EVENT and re-read storage, so every mounted copy of
// useJourneyProgress / useAssessmentHistory stays in step.

export const PROGRESS_EVENT = 'asknelson:progress'
export const MEDITATION_PREFS_KEY = 'asknelson.meditation.prefs'

const OUTBOX_KEY = 'asknelson.progress.outbox'
const ACTIVE_KEY = 'asknelson.activeJourney'
const JOURNEY_PREFIX = 'asknelson.journey.'
const ASSESSMENT_PREFIX = 'asknelson.assessment.'
const MAX_OUTBOX = 200
const FLUSH_DELAY_MS = 800
// Sign-in and admin screens are never "where you left off".
const UNRESUMABLE = /^\/(login|register|forgot|reset|admin)(?:[/?#]|$)/

const state = { enabled: false, flushing: false, timer: null, failures: 0 }

// --- storage (never throws: Safari private mode, WhatsApp webviews, etc.) -----

function read(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota or privacy mode */
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function storedKeys() {
  try {
    return Object.keys(localStorage)
  } catch {
    return []
  }
}

function readJSON(key, fallback) {
  try {
    const raw = read(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function notifyProgressChanged() {
  window.dispatchEvent(new Event(PROGRESS_EVENT))
}

// --- outbox -------------------------------------------------------------------

function loadOutbox() {
  const items = readJSON(OUTBOX_KEY, [])
  return Array.isArray(items) ? items : []
}

function saveOutbox(items) {
  write(OUTBOX_KEY, JSON.stringify(items.slice(-MAX_OUTBOX)))
}

function scheduleFlush(delay = FLUSH_DELAY_MS) {
  window.clearTimeout(state.timer)
  state.timer = window.setTimeout(flush, delay)
}

// `coalesce` replaces any queued op with the same tag — only the latest
// route or active journey matters, not every step on the way there.
function enqueue(method, path, body, { coalesce } = {}) {
  if (!state.enabled) return
  let items = loadOutbox()
  if (coalesce) items = items.filter((op) => op.coalesce !== coalesce)
  items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, method, path, body, coalesce })
  saveOutbox(items)
  scheduleFlush()
}

async function flush() {
  if (!state.enabled || state.flushing || navigator.onLine === false) return
  state.flushing = true
  try {
    for (;;) {
      const op = loadOutbox()[0]
      if (!op) break
      const res = await fetch(`/api/progress${op.path}`, {
        method: op.method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op.body ?? {}),
        keepalive: true,
      })
      if (res.status === 401) {
        // Signed out elsewhere (or the session expired): nothing to send to.
        state.enabled = false
        saveOutbox([])
        break
      }
      if (res.status >= 500 || res.status === 408 || res.status === 429) {
        throw new Error(`HTTP ${res.status}`)
      }
      // Sent — or rejected as invalid, which retrying won't change. Remove by
      // id: a coalesced enqueue may have reshuffled the queue meanwhile.
      saveOutbox(loadOutbox().filter((item) => item.id !== op.id))
      state.failures = 0
    }
  } catch {
    // Offline or a server error: back off, capped at a minute.
    state.failures += 1
    scheduleFlush(Math.min(2000 * 2 ** state.failures, 60_000))
  } finally {
    state.flushing = false
  }
}

window.addEventListener('online', () => {
  state.failures = 0
  if (state.enabled) scheduleFlush(0)
})

// --- sign-in / sign-out -------------------------------------------------------

export function setSyncEnabled(on) {
  state.enabled = on
  if (on) scheduleFlush(0)
}

function localSnapshot() {
  const journeys = {}
  const assessments = {}
  for (const key of storedKeys()) {
    if (key.startsWith(JOURNEY_PREFIX)) {
      const value = readJSON(key, null)
      if (value) journeys[key.slice(JOURNEY_PREFIX.length)] = value
    } else if (key.startsWith(ASSESSMENT_PREFIX)) {
      const value = readJSON(key, null)
      if (value) assessments[key.slice(ASSESSMENT_PREFIX.length)] = value
    }
  }
  return { activeJourneyId: read(ACTIVE_KEY), journeys, assessments }
}

function applySnapshot(snapshot) {
  for (const key of storedKeys()) {
    if (key.startsWith(JOURNEY_PREFIX) || key.startsWith(ASSESSMENT_PREFIX)) remove(key)
  }
  for (const [id, journey] of Object.entries(snapshot.journeys ?? {})) {
    write(
      JOURNEY_PREFIX + id,
      JSON.stringify({ startDate: journey.startDate, completedDays: journey.completedDays ?? [] })
    )
  }
  for (const [id, record] of Object.entries(snapshot.assessments ?? {})) {
    const { lastScore, lastBand, lastDate, history } = record
    write(ASSESSMENT_PREFIX + id, JSON.stringify({ lastScore, lastBand, lastDate, history }))
  }
  if (snapshot.activeJourneyId) write(ACTIVE_KEY, snapshot.activeJourneyId)
  else remove(ACTIVE_KEY)
  if (snapshot.meditation?.preferences) {
    write(MEDITATION_PREFS_KEY, JSON.stringify(snapshot.meditation.preferences))
  }
  notifyProgressChanged()
}

/**
 * Turn sync on and reconcile: whatever this device holds (progress made while
 * signed out, or offline) is folded into the account, and the merged result
 * replaces local storage. Resolves to the server snapshot, whose
 * `app.lastRoute` is where the member left off.
 */
export async function syncOnSignIn() {
  setSyncEnabled(true)
  await flush()
  const res = await fetch('/api/progress/merge', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(localSnapshot()),
  })
  if (!res.ok) throw new Error(`Progress sync failed (${res.status})`)
  const snapshot = await res.json()
  applySnapshot(snapshot)
  return snapshot
}

/**
 * On sign-out, remove this member's progress from the device, so the next
 * person to pick up a shared phone doesn't see their journey or scores.
 */
export function clearLocalProgress() {
  state.enabled = false
  window.clearTimeout(state.timer)
  for (const key of storedKeys()) {
    if (key.startsWith(JOURNEY_PREFIX) || key.startsWith(ASSESSMENT_PREFIX)) remove(key)
  }
  remove(ACTIVE_KEY)
  remove(MEDITATION_PREFS_KEY)
  remove(OUTBOX_KEY)
  notifyProgressChanged()
}

// --- writes (no-ops unless signed in) -----------------------------------------

const enc = encodeURIComponent

export const pushJourney = (journeyId, progress, { active, totalDays } = {}) =>
  enqueue('PUT', `/journeys/${enc(journeyId)}`, {
    startDate: progress.startDate,
    completedDays: progress.completedDays,
    active,
    totalDays,
  })

export const pushDayDone = (journeyId, day, totalDays) =>
  enqueue('POST', `/journeys/${enc(journeyId)}/days`, { day, totalDays })

export const pushActiveJourney = (journeyId) =>
  enqueue('PUT', '/active-journey', { journeyId }, { coalesce: 'active-journey' })

export const pushAssessmentResult = (assessmentId, entry) =>
  enqueue('POST', `/assessments/${enc(assessmentId)}/results`, {
    score: entry.score,
    band: entry.band,
    takenAt: entry.date,
  })

export const pushMeditation = (session) => enqueue('POST', '/meditation', session)

export const pushContentOpened = (content) => enqueue('POST', '/content/opened', content)

export function pushLastRoute(route) {
  if (!route || UNRESUMABLE.test(route)) return
  enqueue('PUT', '/app-state', { lastRoute: route }, { coalesce: 'app-state' })
}
