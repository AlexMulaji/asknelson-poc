import crypto from 'node:crypto'
import express from 'express'
import { isEnabled, query, withTransaction } from './db.js'
import { aad, blindIndex, open, openJson, seal, sealJson } from './crypto.js'
import { noStore, rateLimiter, str } from './http.js'
import { requireUser } from './session.js'

// Server-side progress, so a member can continue where they left off — after
// clearing their browser, or on another device after signing in.
//
// The client keeps rendering from localStorage (instant, offline); this is the
// durable copy behind it. The snapshot deliberately mirrors the localStorage
// layout used by useJourneyProgress / useAssessmentHistory, so the client
// hydrates by writing it straight back.
//
// Item ids (which journey, which assessment, which article) are sealed and
// looked up by a per-user blind index — see migration 003 for why.

const MAX_HISTORY = 20
const MAX_RECENT = 20
const MAX_DAY = 366
const MAX_MERGE_ITEMS = 50
const ID_RE = /^[\w.:-]{1,80}$/

const keyFor = (userId, kind, id) => blindIndex(`${userId}:${id}`, kind)
const rowCtx = (table, column, userId, key) => aad(table, column, `${userId}:${key}`)

// --- input cleaning -------------------------------------------------------------

function cleanId(value) {
  const s = String(value ?? '').trim()
  return ID_RE.test(s) ? s : null
}

function cleanDays(list) {
  if (!Array.isArray(list)) return []
  const days = new Set()
  for (const d of list.slice(0, MAX_DAY)) {
    const n = Number(d)
    if (Number.isInteger(n) && n >= 1 && n <= MAX_DAY) days.add(n)
  }
  return [...days].sort((a, b) => a - b)
}

function cleanTotal(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= MAX_DAY ? n : undefined
}

// Client clocks drift. Never in the future; nothing before the app existed.
function cleanDate(value) {
  const t = Date.parse(value)
  if (!Number.isFinite(t) || t < Date.UTC(2024, 0, 1)) return null
  return new Date(Math.min(t, Date.now()))
}

function cleanRoute(value) {
  const s = String(value ?? '')
  if (!s.startsWith('/') || s.startsWith('//') || s.length > 256) return null
  // Resuming into a sign-in or admin screen is never "where they left off".
  if (/^\/(login|register|forgot|reset|admin)(?:[/?#]|$)/.test(s)) return null
  return s
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value ?? ''))
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.href.length <= 1000
      ? url.href
      : null
  } catch {
    return null
  }
}

// --- journeys -------------------------------------------------------------------

/**
 * Create or update one journey row, inside a transaction.
 *
 *   completedDays  replace the completed-day list
 *   mergeDays      union into it (marking a day done, merging a device)
 *   startedAt      replace the start date
 *   earliestStart  keep whichever start is earlier
 *   totalDays      the journey's length, so completion can be recorded
 *   active         true/false to (de)activate; undefined leaves it as is
 */
async function saveJourney(db, userId, journeyId, changes) {
  const key = keyFor(userId, 'journey', journeyId)
  const ctx = rowCtx('user_journey_progress', 'state', userId, key)
  const { rows } = await db.query(
    'SELECT * FROM user_journey_progress WHERE user_id = $1 AND journey_key = $2 FOR UPDATE',
    [userId, key]
  )
  const existing = rows[0] ?? null
  const previous = existing ? openJson(existing.state_enc, ctx) : null

  let days = changes.completedDays ?? previous?.completedDays ?? []
  if (changes.mergeDays) days = cleanDays([...days, ...changes.mergeDays])

  let startedAt = changes.startedAt ?? existing?.started_at ?? new Date()
  if (changes.earliestStart && changes.earliestStart < startedAt) startedAt = changes.earliestStart

  const total = changes.totalDays ?? existing?.total_days ?? null
  const active = changes.active ?? existing?.is_active ?? false
  const completed = total != null && days.length >= total

  // One active journey per person (a partial unique index backs this up).
  if (active) {
    await db.query(
      'UPDATE user_journey_progress SET is_active = false WHERE user_id = $1 AND is_active AND journey_key <> $2',
      [userId, key]
    )
  }

  await db.query(
    `INSERT INTO user_journey_progress
       (user_id, journey_key, state_enc, is_active, status, days_completed, total_days,
        started_at, last_activity_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9)
     ON CONFLICT (user_id, journey_key) DO UPDATE SET
       state_enc        = EXCLUDED.state_enc,
       is_active        = EXCLUDED.is_active,
       status           = EXCLUDED.status,
       days_completed   = EXCLUDED.days_completed,
       total_days       = EXCLUDED.total_days,
       started_at       = EXCLUDED.started_at,
       last_activity_at = now(),
       completed_at     = EXCLUDED.completed_at`,
    [
      userId,
      key,
      sealJson({ journeyId, completedDays: days }, ctx),
      active,
      completed ? 'completed' : 'in_progress',
      days.length,
      total,
      startedAt,
      completed ? (existing?.completed_at ?? new Date()) : null,
    ]
  )
}

async function setActiveJourney(db, userId, journeyId) {
  await db.query('UPDATE user_journey_progress SET is_active = false WHERE user_id = $1 AND is_active', [userId])
  if (journeyId) await saveJourney(db, userId, journeyId, { active: true })
}

// --- other writers --------------------------------------------------------------

async function saveAssessmentResult(db, userId, assessmentId, { score, band, takenAt }) {
  const key = keyFor(userId, 'assessment', assessmentId)
  await db.query(
    `INSERT INTO user_assessment_results (id, user_id, assessment_key, result_enc, taken_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, assessment_key, taken_at) DO NOTHING`,
    [
      crypto.randomUUID(),
      userId,
      key,
      sealJson({ assessmentId, score, band }, rowCtx('user_assessment_results', 'result', userId, key)),
      takenAt,
    ]
  )
}

function cleanResult(entry) {
  const score = Number(entry?.score)
  const takenAt = cleanDate(entry?.date ?? entry?.takenAt)
  if (!Number.isFinite(score) || Math.abs(score) > 1000 || !takenAt) return null
  return { score, band: str(entry?.band, 80), takenAt }
}

async function readPreferences(db, userId) {
  const { rows } = await db.query('SELECT preferences_enc FROM user_app_state WHERE user_id = $1', [userId])
  return openJson(rows[0]?.preferences_enc, aad('user_app_state', 'preferences', userId)) ?? {}
}

async function writeAppState(db, userId, { lastRoute, preferences }) {
  await db.query(
    `INSERT INTO user_app_state (user_id, last_route_enc, preferences_enc, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET
       last_route_enc  = COALESCE(EXCLUDED.last_route_enc, user_app_state.last_route_enc),
       preferences_enc = COALESCE(EXCLUDED.preferences_enc, user_app_state.preferences_enc),
       updated_at      = now()`,
    [
      userId,
      lastRoute ? seal(lastRoute, aad('user_app_state', 'last_route', userId)) : null,
      preferences ? sealJson(preferences, aad('user_app_state', 'preferences', userId)) : null,
    ]
  )
}

// --- snapshot -------------------------------------------------------------------

/** Everything the client needs to resume, in the localStorage shape. */
export async function progressSnapshot(userId, db = { query }) {
  const [journeyRows, resultRows, meditationRows, meditationTotals, contentRows, appRows] =
    await Promise.all([
      db.query('SELECT * FROM user_journey_progress WHERE user_id = $1', [userId]),
      db.query(
        `SELECT assessment_key, result_enc, taken_at FROM user_assessment_results
          WHERE user_id = $1 ORDER BY taken_at`,
        [userId]
      ),
      db.query(
        `SELECT planned_sec, elapsed_sec, sound, completed, ended_at FROM user_meditation_sessions
          WHERE user_id = $1 ORDER BY ended_at DESC LIMIT 10`,
        [userId]
      ),
      db.query(
        `SELECT count(*)::int AS sessions,
                count(*) FILTER (WHERE completed)::int AS completed,
                COALESCE(sum(elapsed_sec), 0)::int AS seconds
           FROM user_meditation_sessions WHERE user_id = $1`,
        [userId]
      ),
      db.query(
        `SELECT content_key, content_enc, open_count, first_opened_at, last_opened_at
           FROM user_content_activity WHERE user_id = $1
          ORDER BY last_opened_at DESC LIMIT ${MAX_RECENT}`,
        [userId]
      ),
      db.query('SELECT * FROM user_app_state WHERE user_id = $1', [userId]),
    ])

  let activeJourneyId = null
  const journeys = {}
  for (const row of journeyRows.rows) {
    const state = openJson(row.state_enc, rowCtx('user_journey_progress', 'state', userId, row.journey_key))
    journeys[state.journeyId] = {
      startDate: row.started_at.toISOString(),
      completedDays: state.completedDays,
      status: row.status,
      lastActivityAt: row.last_activity_at.toISOString(),
    }
    if (row.is_active) activeJourneyId = state.journeyId
  }

  const assessments = {}
  for (const row of resultRows.rows) {
    const result = openJson(
      row.result_enc,
      rowCtx('user_assessment_results', 'result', userId, row.assessment_key)
    )
    const record = (assessments[result.assessmentId] ??= { history: [] })
    record.history.push({ date: row.taken_at.toISOString(), score: result.score, band: result.band ?? null })
  }
  for (const record of Object.values(assessments)) {
    record.history = record.history.slice(-MAX_HISTORY)
    const last = record.history[record.history.length - 1]
    record.lastScore = last.score
    record.lastBand = last.band
    record.lastDate = last.date
  }

  const app = appRows.rows[0]
  return {
    activeJourneyId,
    journeys,
    assessments,
    meditation: {
      preferences: openJson(app?.preferences_enc, aad('user_app_state', 'preferences', userId))?.meditation ?? null,
      totals: meditationTotals.rows[0],
      recent: meditationRows.rows.map((r) => ({
        durationMin: Math.round(r.planned_sec / 60),
        elapsedSec: r.elapsed_sec,
        sound: r.sound,
        completed: r.completed,
        endedAt: r.ended_at.toISOString(),
      })),
    },
    content: {
      recent: contentRows.rows.map((r) => ({
        ...openJson(r.content_enc, rowCtx('user_content_activity', 'content', userId, r.content_key)),
        openCount: r.open_count,
        firstOpenedAt: r.first_opened_at.toISOString(),
        lastOpenedAt: r.last_opened_at.toISOString(),
      })),
    },
    app: {
      lastRoute: open(app?.last_route_enc, aad('user_app_state', 'last_route', userId)),
      updatedAt: app?.updated_at?.toISOString() ?? null,
    },
  }
}

// --- router ---------------------------------------------------------------------

export function createProgressRouter() {
  const router = express.Router()

  router.use(express.json({ limit: '256kb' }))
  router.use(noStore)
  router.use((req, res, next) => {
    if (!isEnabled) return res.status(503).json({ error: 'Progress sync is unavailable — no database configured.' })
    next()
  })
  router.use(rateLimiter({ windowMs: 60_000, max: 300 }))
  router.use(requireUser)

  const handle = (fn) => async (req, res) => {
    try {
      await fn(req, res)
    } catch (err) {
      console.error(`[asknelson][progress] ${req.method} ${req.path} failed:`, err.message)
      res.status(500).json({ error: 'Could not save your progress.' })
    }
  }

  const badRequest = (res, message) => res.status(400).json({ error: message })

  router.get(
    '/',
    handle(async (req, res) => {
      res.json(await progressSnapshot(req.user.id))
    })
  )

  /** Start, restart or overwrite a journey. */
  router.put(
    '/journeys/:journeyId',
    handle(async (req, res) => {
      const journeyId = cleanId(req.params.journeyId)
      if (!journeyId) return badRequest(res, 'Unknown journey.')
      const b = req.body || {}
      await withTransaction((db) =>
        saveJourney(db, req.user.id, journeyId, {
          completedDays: Array.isArray(b.completedDays) ? cleanDays(b.completedDays) : undefined,
          startedAt: b.startDate ? (cleanDate(b.startDate) ?? undefined) : undefined,
          totalDays: cleanTotal(b.totalDays),
          active: typeof b.active === 'boolean' ? b.active : undefined,
        })
      )
      res.json({ ok: true })
    })
  )

  /** Mark one day done. Idempotent. */
  router.post(
    '/journeys/:journeyId/days',
    handle(async (req, res) => {
      const journeyId = cleanId(req.params.journeyId)
      const [day] = cleanDays([req.body?.day])
      if (!journeyId || !day) return badRequest(res, 'Unknown journey day.')
      await withTransaction((db) =>
        saveJourney(db, req.user.id, journeyId, { mergeDays: [day], totalDays: cleanTotal(req.body?.totalDays) })
      )
      res.json({ ok: true })
    })
  )

  router.put(
    '/active-journey',
    handle(async (req, res) => {
      const raw = req.body?.journeyId
      const journeyId = raw == null ? null : cleanId(raw)
      if (raw != null && !journeyId) return badRequest(res, 'Unknown journey.')
      await withTransaction((db) => setActiveJourney(db, req.user.id, journeyId))
      res.json({ ok: true })
    })
  )

  router.post(
    '/assessments/:assessmentId/results',
    handle(async (req, res) => {
      const assessmentId = cleanId(req.params.assessmentId)
      const result = cleanResult(req.body)
      if (!assessmentId || !result) return badRequest(res, 'Invalid result.')
      await saveAssessmentResult({ query }, req.user.id, assessmentId, result)
      res.json({ ok: true })
    })
  )

  router.post(
    '/meditation',
    handle(async (req, res) => {
      const b = req.body || {}
      const durationMin = Number(b.durationMin)
      const elapsedSec = Number(b.elapsedSec)
      const sound = /^[\w-]{1,32}$/.test(String(b.sound ?? '')) ? String(b.sound) : null
      if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 180) {
        return badRequest(res, 'Invalid duration.')
      }
      if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return badRequest(res, 'Invalid elapsed time.')

      await withTransaction(async (db) => {
        await db.query(
          `INSERT INTO user_meditation_sessions (id, user_id, planned_sec, elapsed_sec, sound, completed)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            crypto.randomUUID(),
            req.user.id,
            durationMin * 60,
            Math.min(Math.round(elapsedSec), durationMin * 60),
            sound,
            Boolean(b.completed),
          ]
        )
        // The last settings used become the defaults next time.
        const preferences = await readPreferences(db, req.user.id)
        await writeAppState(db, req.user.id, { preferences: { ...preferences, meditation: { durationMin, sound } } })
      })
      res.json({ ok: true })
    })
  )

  router.post(
    '/content/opened',
    handle(async (req, res) => {
      const b = req.body || {}
      const contentId = cleanId(b.contentId)
      const url = cleanUrl(b.url)
      if (!contentId && !url) return badRequest(res, 'Unknown content.')
      const key = keyFor(req.user.id, 'content', contentId || url)
      const content = {
        contentId,
        url,
        title: str(b.title, 200),
        themeId: cleanId(b.themeId),
        type: str(b.type, 16),
      }
      await query(
        `INSERT INTO user_content_activity (user_id, content_key, content_enc)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, content_key) DO UPDATE SET
           content_enc    = EXCLUDED.content_enc,
           open_count     = user_content_activity.open_count + 1,
           last_opened_at = now()`,
        [req.user.id, key, sealJson(content, rowCtx('user_content_activity', 'content', req.user.id, key))]
      )
      res.json({ ok: true })
    })
  )

  router.put(
    '/app-state',
    handle(async (req, res) => {
      const lastRoute = cleanRoute(req.body?.lastRoute)
      if (!lastRoute) return badRequest(res, 'Invalid route.')
      await writeAppState({ query }, req.user.id, { lastRoute })
      res.json({ ok: true })
    })
  )

  /**
   * First sync after sign-in: fold whatever this device holds (progress made
   * signed-out, or offline) into the account, then return the merged result.
   * Days are unioned and the earlier start date wins; the account's active
   * journey wins over the device's, so the most recent place you left off —
   * on any device — is where you resume.
   */
  router.post(
    '/merge',
    handle(async (req, res) => {
      const b = req.body || {}
      const userId = req.user.id
      const entries = (obj) =>
        obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.entries(obj).slice(0, MAX_MERGE_ITEMS) : []
      const localActive = cleanId(b.activeJourneyId)

      const snapshot = await withTransaction(async (db) => {
        const { rows } = await db.query(
          'SELECT 1 FROM user_journey_progress WHERE user_id = $1 AND is_active',
          [userId]
        )
        const adoptLocalActive = rows.length === 0 && localActive

        for (const [rawId, local] of entries(b.journeys)) {
          const journeyId = cleanId(rawId)
          if (!journeyId || !local || typeof local !== 'object') continue
          await saveJourney(db, userId, journeyId, {
            mergeDays: cleanDays(local.completedDays),
            earliestStart: cleanDate(local.startDate) ?? undefined,
            active: adoptLocalActive && journeyId === localActive ? true : undefined,
          })
        }
        if (adoptLocalActive && !entries(b.journeys).some(([id]) => id === localActive)) {
          await setActiveJourney(db, userId, localActive)
        }

        for (const [rawId, record] of entries(b.assessments)) {
          const assessmentId = cleanId(rawId)
          if (!assessmentId || !Array.isArray(record?.history)) continue
          for (const entry of record.history.slice(-MAX_HISTORY)) {
            const result = cleanResult(entry)
            if (result) await saveAssessmentResult(db, userId, assessmentId, result)
          }
        }

        return progressSnapshot(userId, db)
      })
      res.json(snapshot)
    })
  )

  return router
}
