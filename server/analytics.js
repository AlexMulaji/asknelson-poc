import express from 'express'
import crypto from 'node:crypto'
import { isEnabled, query, sweepStaleSessions } from './db.js'
import { aad, blindIndex, open, openJson, seal, sealJson } from './crypto.js'
import { audit } from './audit.js'
import { baseUrl, isSecure, rateLimiter, readCookie } from './http.js'
import { rollupDims } from './rollups.js'

// Event tracking: ingest from the PWA, plus the admin read/export API.
//
// The chain is device -> session -> event. The device id is minted in the
// browser and mirrored to a first-party cookie; a WhatsApp link token (?t=…)
// or an identified sign-in binds that device to a member, so every event can be
// traced back to a person without ever putting an identifier in the URL beyond
// the opaque token.
//
// At rest (POPIA s19): ids, event names and timestamps are stored in the clear
// so reporting can count and order them; everything descriptive — event props,
// paths, referrers, user agents, member refs and labels — is sealed with
// AES-256-GCM (crypto.js) and only opened here, for an admin or the member.
// Reporting that needs prop values reads analytics_daily_counts instead, which
// holds no ids at all.

export const DEVICE_COOKIE = 'an_did'
const COOKIE_MAX_AGE_DAYS = 400 // browsers cap first-party cookies here anyway

const MAX_EVENTS_PER_BATCH = 50
const MAX_NAME_LEN = 64
const MAX_PATH_LEN = 512
const MAX_TEXT_LEN = 1024
const MAX_PROPS_BYTES = 4096

// Known events get a category so the admin overview can group them without a
// hard-coded list in the UI. Anything else is accepted and filed as 'custom' —
// adding a new event in the app never requires a server change.
const EVENT_CATEGORIES = {
  session_start: 'session',
  session_end: 'session',
  page_view: 'navigation',
  app_installed: 'lifecycle',
  connectivity_change: 'lifecycle',
  content_opened: 'content',
  theme_filtered: 'content',
  external_opened: 'content',
  external_closed: 'content',
  external_opened_outside: 'content',
  journey_started: 'journey',
  journey_switched: 'journey',
  journey_day_completed: 'journey',
  journey_completed: 'journey',
  journey_resource_opened: 'journey',
  assessment_started: 'assessment',
  assessment_completed: 'assessment',
  assessment_abandoned: 'assessment',
  meditation_started: 'meditation',
  meditation_completed: 'meditation',
  meditation_stopped: 'meditation',
  sos_pressed: 'support',
  booking_clicked: 'support',
  registration_started: 'auth',
  registration_step_completed: 'auth',
  registration_otp_sent: 'auth',
  registration_otp_resent: 'auth',
  registration_verification_failed: 'auth',
  registered: 'auth',
  signed_in: 'auth',
  sign_in_failed: 'auth',
  signed_out: 'auth',
  password_reset_requested: 'auth',
  password_reset_completed: 'auth',
  progress_restored: 'progress',
}

// --- helpers ------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// Client ids are sealed into encryption contexts and used as map keys, then
// compared with what Postgres returns — which is always lower-case. Normalise
// on the way in, or an upper-case id would write values that never decrypt.
function clientUuid(value) {
  return isUuid(value) ? value.toLowerCase() : null
}

function str(value, max = MAX_TEXT_LEN) {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  return s.slice(0, max)
}

function int(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

// Clamp client timestamps into a sane window. Phone clocks drift and can be
// wildly wrong; without this a single bad device skews every time-based query.
function clampTimestamp(value) {
  const t = Date.parse(value)
  const now = Date.now()
  if (!Number.isFinite(t)) return new Date(now)
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
  if (t < thirtyDaysAgo) return new Date(thirtyDaysAgo)
  if (t > now + 60_000) return new Date(now)
  return new Date(t)
}

function sanitiseProps(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {}
  const out = {}
  for (const [key, value] of Object.entries(props)) {
    if (key.length > 40) continue
    if (value == null) continue
    if (typeof value === 'number') out[key] = Number.isFinite(value) ? value : null
    else if (typeof value === 'boolean') out[key] = value
    else out[key] = String(value).slice(0, 256)
  }
  // Individual values are capped at 256 chars above; this catches an object
  // with enough keys to still be oversized. Such a payload is dropped whole
  // rather than partially kept — half a props object is more misleading in
  // analysis than none. The event itself is still recorded either way.
  return JSON.stringify(out).length > MAX_PROPS_BYTES ? {} : out
}

// --- encrypted columns --------------------------------------------------------

const deviceCtx = (column, id) => aad('analytics_devices', column, id)
const sessionCtx = (column, id) => aad('analytics_sessions', column, id)
const eventCtx = (column, uid) => aad('analytics_events', column, uid)
// Members are keyed by the ref's blind index rather than their row id, so an
// upsert that keeps an existing row still seals against a matching context.
const memberCtx = (column, refHash) => aad('analytics_members', column, refHash)
const tokenLabelCtx = (tokenHash) => aad('analytics_link_tokens', 'label', tokenHash)

const memberRef = (row) =>
  row.external_ref_hash ? open(row.external_ref_enc, memberCtx('external_ref', row.external_ref_hash)) : null
const memberLabel = (row) =>
  row.external_ref_hash ? open(row.label_enc, memberCtx('label', row.external_ref_hash)) : null

function decryptEvent(row) {
  return {
    path: open(row.path_enc, eventCtx('path', row.event_uid)),
    props: openJson(row.props_enc, eventCtx('props', row.event_uid)) ?? {},
  }
}

// --- member linking -----------------------------------------------------------

/**
 * Find or create the member for one of *your* identifiers (a staff number, a
 * CRM id). Returns the member id.
 */
export async function upsertMember(externalRef, label = null) {
  const refHash = blindIndex(externalRef, 'member')
  const { rows } = await query(
    `INSERT INTO analytics_members (id, external_ref_hash, external_ref_enc, label_enc)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (external_ref_hash)
       DO UPDATE SET label_enc = COALESCE(EXCLUDED.label_enc, analytics_members.label_enc)
     RETURNING id`,
    [
      crypto.randomUUID(),
      refHash,
      seal(externalRef, memberCtx('external_ref', refHash)),
      seal(label, memberCtx('label', refHash)),
    ]
  )
  return rows[0].id
}

// Resolve a WhatsApp link token to a member. Returns null for unknown, expired
// or revoked tokens — an invalid token is never an error the user has to see,
// their session just stays anonymous.
async function resolveToken(token) {
  const tokenHash = hashToken(token)
  const { rows } = await query(
    `UPDATE analytics_link_tokens
        SET use_count     = use_count + 1,
            first_used_at = COALESCE(first_used_at, now()),
            last_used_at  = now()
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      RETURNING member_id`,
    [tokenHash]
  )
  return rows[0]?.member_id ?? null
}

// Bind a device to a member. When the device was previously anonymous we
// backfill its existing sessions and events, so a visit that started before the
// token was recognised still belongs to the right person.
async function linkDevice(deviceId, memberId) {
  const { rows } = await query('SELECT member_id FROM analytics_devices WHERE id = $1', [deviceId])
  const previous = rows[0]?.member_id ?? null
  if (previous === memberId) return

  await query(
    'UPDATE analytics_devices SET member_id = $2, linked_at = now() WHERE id = $1',
    [deviceId, memberId]
  )

  if (previous == null) {
    await query(
      'UPDATE analytics_sessions SET member_id = $2 WHERE device_id = $1 AND member_id IS NULL',
      [deviceId, memberId]
    )
    await query(
      'UPDATE analytics_events SET member_id = $2 WHERE device_id = $1 AND member_id IS NULL',
      [deviceId, memberId]
    )
  }
}

/**
 * Bind the browser making this request to a member, using the device cookie the
 * tracker set. Called when someone registers or signs in with an identified
 * account, so their events attribute to them from that point on — and, via the
 * backfill in linkDevice, retrospectively too.
 *
 * Never called for anonymous accounts: that is what keeps their activity
 * genuinely unattributable.
 */
export async function linkDeviceFromRequest(req, memberId) {
  if (!isEnabled || !memberId) return false
  const deviceId = readCookie(req, DEVICE_COOKIE)
  if (!isUuid(deviceId)) return false
  const { rows } = await query('SELECT 1 FROM analytics_devices WHERE id = $1', [deviceId])
  if (rows.length === 0) return false
  await linkDevice(deviceId, memberId)
  return true
}

/** Every event attributed to a member, decrypted — for their POPIA data export. */
export async function memberActivity(memberId, limit = 10000) {
  const { rows } = await query(
    `SELECT event_uid, name, category, path_enc, props_enc, occurred_at
       FROM analytics_events WHERE member_id = $1
      ORDER BY occurred_at LIMIT $2`,
    [memberId, limit]
  )
  return rows.map((r) => ({ name: r.name, category: r.category, occurredAt: r.occurred_at, ...decryptEvent(r) }))
}

// Add accepted events to the de-identified daily counts. One upsert for the
// whole batch; the day is the UTC date of the (clamped) event time.
async function rollUp(events) {
  const counts = new Map()
  const bump = (day, name, dims) => {
    const key = `${day}|${name}|${JSON.stringify(dims)}`
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { day, name, dims, count: 1 })
  }
  for (const e of events) {
    const day = e.occurredAt.toISOString().slice(0, 10)
    bump(day, e.name, {})
    const dims = rollupDims(e.name, e.props)
    if (dims) bump(day, e.name, dims)
  }
  const rows = [...counts.values()]
  if (rows.length === 0) return
  await query(
    `INSERT INTO analytics_daily_counts (day, event_name, dims, count)
     SELECT * FROM unnest($1::date[], $2::text[], $3::jsonb[], $4::int[])
     ON CONFLICT (day, event_name, dims)
       DO UPDATE SET count = analytics_daily_counts.count + EXCLUDED.count`,
    [
      rows.map((r) => r.day),
      rows.map((r) => r.name),
      rows.map((r) => JSON.stringify(r.dims)),
      rows.map((r) => r.count),
    ]
  )
}

// --- router -------------------------------------------------------------------

export function createAnalyticsRouter({ requireAdmin }) {
  const router = express.Router()

  // sendBeacon (used on pagehide, the only reliable moment to flush) posts a
  // Blob whose type some browsers rewrite to text/plain, so accept both.
  const parseBody = express.json({
    type: ['application/json', 'text/plain'],
    limit: '256kb',
  })

  // When no DATABASE_URL is set, tracking is a silent no-op: the PWA keeps
  // working and simply gets nothing back to store.
  router.use((req, res, next) => {
    if (!isEnabled) {
      if (req.path.startsWith('/admin')) {
        return res.status(503).json({ error: 'Analytics database is not configured' })
      }
      return res.status(204).end()
    }
    next()
  })

  // --- ingest -----------------------------------------------------------------

  const ingestLimiter = rateLimiter({ windowMs: 60_000, max: 240 })

  /**
   * Open or resume a session. Called once on app start and again whenever the
   * client rolls a new session after 30 minutes idle. Returns the ids the
   * client should use from then on.
   */
  router.post('/session', ingestLimiter, parseBody, async (req, res) => {
    try {
      const body = req.body || {}
      const ctx = body.context || {}

      // Device id precedence: what the client sent, else the cookie (localStorage
      // was cleared, or the WhatsApp browser sandboxed it), else a new one.
      const deviceId =
        clientUuid(body.deviceId) ?? clientUuid(readCookie(req, DEVICE_COOKIE)) ?? crypto.randomUUID()
      const sessionId = clientUuid(body.sessionId) ?? crypto.randomUUID()
      const userAgent = str(req.get('user-agent'), MAX_TEXT_LEN)
      const isWhatsapp = Boolean(ctx.isWhatsapp) || /WhatsApp/i.test(userAgent || '')
      const utm = sanitiseProps(ctx.utm)
      const hasUtm = Object.keys(utm).length > 0
      const referrer = str(ctx.referrer, MAX_PATH_LEN)
      const path = str(ctx.path, MAX_PATH_LEN)

      await query(
        `INSERT INTO analytics_devices
           (id, user_agent_enc, platform, language, timezone, screen_w, screen_h,
            display_mode, is_whatsapp, first_referrer_enc, first_landing_path_enc, first_utm_enc)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           last_seen_at           = now(),
           user_agent_enc         = EXCLUDED.user_agent_enc,
           platform               = EXCLUDED.platform,
           language               = EXCLUDED.language,
           timezone               = EXCLUDED.timezone,
           screen_w               = EXCLUDED.screen_w,
           screen_h               = EXCLUDED.screen_h,
           display_mode           = EXCLUDED.display_mode,
           is_whatsapp            = analytics_devices.is_whatsapp OR EXCLUDED.is_whatsapp,
           -- "first_*" columns record acquisition and must never be overwritten.
           first_referrer_enc     = COALESCE(analytics_devices.first_referrer_enc, EXCLUDED.first_referrer_enc),
           first_landing_path_enc = COALESCE(analytics_devices.first_landing_path_enc, EXCLUDED.first_landing_path_enc),
           first_utm_enc          = COALESCE(analytics_devices.first_utm_enc, EXCLUDED.first_utm_enc)`,
        [
          deviceId,
          seal(userAgent, deviceCtx('user_agent', deviceId)),
          str(ctx.platform, 128),
          str(ctx.language, 32),
          str(ctx.timezone, 64),
          int(ctx.screenW),
          int(ctx.screenH),
          str(ctx.displayMode, 32),
          isWhatsapp,
          seal(referrer, deviceCtx('first_referrer', deviceId)),
          seal(path, deviceCtx('first_landing_path', deviceId)),
          hasUtm ? sealJson(utm, deviceCtx('first_utm', deviceId)) : null,
        ]
      )

      // A token may arrive on any visit, not just the first.
      let memberId = null
      if (typeof body.token === 'string' && body.token.length >= 8 && body.token.length <= 256) {
        memberId = await resolveToken(body.token)
        if (memberId) await linkDevice(deviceId, memberId)
      }
      if (!memberId) {
        const { rows } = await query('SELECT member_id FROM analytics_devices WHERE id = $1', [
          deviceId,
        ])
        memberId = rows[0]?.member_id ?? null
      }

      const { rows: sessionRows } = await query(
        `INSERT INTO analytics_sessions
           (id, device_id, member_id, source, entry_path_enc, referrer_enc, utm_enc,
            display_mode, user_agent_enc, is_whatsapp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           last_seen_at = now(),
           member_id    = COALESCE(EXCLUDED.member_id, analytics_sessions.member_id)
         RETURNING (xmax = 0) AS created`,
        [
          sessionId,
          deviceId,
          memberId,
          str(ctx.source, 32) || (isWhatsapp ? 'whatsapp' : 'direct'),
          seal(path, sessionCtx('entry_path', sessionId)),
          seal(referrer, sessionCtx('referrer', sessionId)),
          hasUtm ? sealJson(utm, sessionCtx('utm', sessionId)) : null,
          str(ctx.displayMode, 32),
          seal(userAgent, sessionCtx('user_agent', sessionId)),
          isWhatsapp,
        ]
      )

      if (sessionRows[0]?.created) {
        await query(
          'UPDATE analytics_devices SET session_count = session_count + 1 WHERE id = $1',
          [deviceId]
        )
      }

      // Mirror the device id into a cookie. Not httpOnly — the client reads it
      // to recover from a cleared localStorage. It holds no personal data and
      // no authority; it only names a device row.
      res.cookie(DEVICE_COOKIE, deviceId, {
        maxAge: COOKIE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
        sameSite: 'lax',
        secure: isSecure(req),
        path: '/',
      })

      res.json({ deviceId, sessionId, linked: Boolean(memberId) })
    } catch (err) {
      console.error('[asknelson] session start failed:', err.message)
      res.status(500).json({ error: 'Failed to start session' })
    }
  })

  /**
   * Ingest a batch of events. Idempotent on event_uid, so the client can retry
   * a batch it is unsure about without creating duplicates.
   */
  router.post('/events', ingestLimiter, parseBody, async (req, res) => {
    try {
      const body = req.body || {}
      const deviceId = clientUuid(body.deviceId)
      const sessionId = clientUuid(body.sessionId)
      const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : []

      if (!deviceId || !sessionId || events.length === 0) {
        return res.status(400).json({ error: 'deviceId, sessionId and events are required' })
      }

      // The session must already exist (created by POST /session). Rejecting
      // rather than creating one keeps orphaned/forged ids out of the store.
      const { rows: sessionRows } = await query(
        'SELECT member_id FROM analytics_sessions WHERE id = $1 AND device_id = $2',
        [sessionId, deviceId]
      )
      if (sessionRows.length === 0) {
        return res.status(409).json({ error: 'Unknown session' })
      }
      const memberId = sessionRows[0].member_id

      const values = []
      const params = []
      const byUid = new Map()
      let i = 0
      for (const event of events) {
        const name = str(event?.name, MAX_NAME_LEN)
        if (!name) continue
        const uid = clientUuid(event.uid) ?? crypto.randomUUID()
        if (byUid.has(uid)) continue
        const props = sanitiseProps(event.props)
        const occurredAt = clampTimestamp(event.at)
        byUid.set(uid, { name, props, occurredAt })
        values.push(`($${++i},$${++i},$${++i},$${++i},$${++i},$${++i},$${++i},$${++i},$${++i},$${++i})`)
        params.push(
          uid,
          sessionId,
          deviceId,
          memberId,
          name,
          EVENT_CATEGORIES[name] || 'custom',
          seal(str(event.path, MAX_PATH_LEN), eventCtx('path', uid)),
          sealJson(props, eventCtx('props', uid)),
          occurredAt,
          int(event.seq)
        )
      }

      if (values.length === 0) return res.status(400).json({ error: 'No valid events' })

      const { rows: inserted } = await query(
        `INSERT INTO analytics_events
           (event_uid, session_id, device_id, member_id, name, category, path_enc, props_enc, occurred_at, client_seq)
         VALUES ${values.join(',')}
         ON CONFLICT (event_uid) DO NOTHING
         RETURNING event_uid`,
        params
      )
      const accepted = inserted.length

      // Count only what was actually new, so a retried batch isn't counted twice.
      await rollUp(inserted.map((r) => byUid.get(r.event_uid)))

      // A session_end event closes the session there and then, rather than
      // waiting for the idle sweeper to notice.
      const ended = events.some((e) => e?.name === 'session_end')
      await query(
        `UPDATE analytics_sessions
            SET last_seen_at = now(),
                event_count  = event_count + $2,
                ended_at     = CASE WHEN $3 THEN now() ELSE ended_at END
          WHERE id = $1`,
        [sessionId, accepted, ended]
      )
      await query(
        'UPDATE analytics_devices SET last_seen_at = now(), event_count = event_count + $2 WHERE id = $1',
        [deviceId, accepted]
      )

      res.json({ ok: true, accepted })
    } catch (err) {
      console.error('[asknelson] event ingest failed:', err.message)
      res.status(500).json({ error: 'Failed to record events' })
    }
  })

  // --- admin: reporting -------------------------------------------------------

  function windowDays(req) {
    const days = Number(req.query.days)
    return Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 365) : 30
  }

  router.get('/admin/overview', requireAdmin, async (req, res) => {
    try {
      const days = windowDays(req)
      const since = `${days} days`

      const [totals, byName, daily, topContent, members] = await Promise.all([
        query(
          `SELECT
             (SELECT count(*) FROM analytics_events   WHERE occurred_at > now() - $1::interval) AS events,
             (SELECT count(*) FROM analytics_sessions WHERE started_at  > now() - $1::interval) AS sessions,
             (SELECT count(DISTINCT device_id) FROM analytics_sessions WHERE started_at > now() - $1::interval) AS devices,
             (SELECT count(DISTINCT member_id) FROM analytics_sessions WHERE started_at > now() - $1::interval AND member_id IS NOT NULL) AS members,
             (SELECT count(*) FROM analytics_sessions WHERE started_at > now() - $1::interval AND is_whatsapp) AS whatsapp_sessions,
             (SELECT count(*) FROM analytics_devices) AS devices_all_time`,
          [since]
        ),
        query(
          `SELECT name, category, count(*)::int AS count
             FROM analytics_events
            WHERE occurred_at > now() - $1::interval
            GROUP BY name, category
            ORDER BY count DESC`,
          [since]
        ),
        query(
          `SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
                  count(*)::int AS events,
                  count(DISTINCT device_id)::int AS devices
             FROM analytics_events
            WHERE occurred_at > now() - $1::interval
            GROUP BY 1
            ORDER BY 1`,
          [since]
        ),
        // Props are encrypted per event, so content popularity comes from the
        // de-identified rollups rather than a scan of the event stream.
        query(
          `SELECT dims->>'title' AS title,
                  dims->>'theme' AS theme,
                  sum(count)::int AS opens
             FROM analytics_daily_counts
            WHERE event_name = 'content_opened'
              AND dims ? 'title'
              AND day > (now() - $1::interval)::date
            GROUP BY 1, 2
            ORDER BY opens DESC
            LIMIT 10`,
          [since]
        ),
        query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE member_id IS NOT NULL)::int AS linked
             FROM analytics_devices`
        ),
      ])

      res.json({
        days,
        totals: totals.rows[0],
        byName: byName.rows,
        daily: daily.rows,
        topContent: topContent.rows,
        deviceLinkage: members.rows[0],
      })
    } catch (err) {
      console.error('[asknelson] overview failed:', err.message)
      res.status(500).json({ error: 'Failed to load overview' })
    }
  })

  router.get('/admin/sessions', requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(Math.max(int(req.query.limit) || 50, 1), 200)
      const offset = Math.max(int(req.query.offset) || 0, 0)
      const { rows } = await query(
        `SELECT s.id, s.device_id, s.started_at, s.last_seen_at, s.ended_at,
                s.source, s.entry_path_enc, s.is_whatsapp, s.event_count,
                m.external_ref_hash, m.external_ref_enc, m.label_enc
           FROM analytics_sessions s
           LEFT JOIN analytics_members m ON m.id = s.member_id
          ORDER BY s.started_at DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset]
      )
      res.json({
        sessions: rows.map(({ entry_path_enc, external_ref_hash, external_ref_enc, label_enc, ...s }) => ({
          ...s,
          entry_path: open(entry_path_enc, sessionCtx('entry_path', s.id)),
          external_ref: memberRef({ external_ref_hash, external_ref_enc }),
          member_label: memberLabel({ external_ref_hash, label_enc }),
        })),
        limit,
        offset,
      })
    } catch (err) {
      console.error('[asknelson] sessions query failed:', err.message)
      res.status(500).json({ error: 'Failed to load sessions' })
    }
  })

  // Everything one device has ever done — the "what did this person see?" view.
  // Opening it decrypts personal information, so it is audited.
  router.get('/admin/devices/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params
      if (!isUuid(id)) return res.status(400).json({ error: 'Invalid device id' })

      const [device, sessions, events] = await Promise.all([
        query(
          `SELECT d.id, d.member_id, d.first_seen_at, d.last_seen_at, d.linked_at,
                  d.user_agent_enc, d.platform, d.language, d.timezone, d.screen_w, d.screen_h,
                  d.display_mode, d.is_whatsapp, d.first_referrer_enc, d.first_landing_path_enc,
                  d.first_utm_enc, d.session_count, d.event_count,
                  m.external_ref_hash, m.external_ref_enc, m.label_enc
             FROM analytics_devices d
             LEFT JOIN analytics_members m ON m.id = d.member_id
            WHERE d.id = $1`,
          [id]
        ),
        query(
          `SELECT id, started_at, last_seen_at, ended_at, source, entry_path_enc, event_count
             FROM analytics_sessions
            WHERE device_id = $1
            ORDER BY started_at DESC
            LIMIT 50`,
          [id]
        ),
        query(
          `SELECT id, event_uid, session_id, name, category, path_enc, props_enc, occurred_at
             FROM analytics_events
            WHERE device_id = $1
            ORDER BY occurred_at DESC
            LIMIT 500`,
          [id]
        ),
      ])

      if (device.rows.length === 0) return res.status(404).json({ error: 'Unknown device' })
      const {
        user_agent_enc,
        first_referrer_enc,
        first_landing_path_enc,
        first_utm_enc,
        external_ref_hash,
        external_ref_enc,
        label_enc,
        ...d
      } = device.rows[0]

      audit(req, { actor: 'admin', action: 'admin_viewed_device', targetType: 'device', targetId: id })
      res.json({
        device: {
          ...d,
          user_agent: open(user_agent_enc, deviceCtx('user_agent', id)),
          first_referrer: open(first_referrer_enc, deviceCtx('first_referrer', id)),
          first_landing_path: open(first_landing_path_enc, deviceCtx('first_landing_path', id)),
          first_utm: openJson(first_utm_enc, deviceCtx('first_utm', id)),
          external_ref: memberRef({ external_ref_hash, external_ref_enc }),
          member_label: memberLabel({ external_ref_hash, label_enc }),
        },
        sessions: sessions.rows.map(({ entry_path_enc, ...s }) => ({
          ...s,
          entry_path: open(entry_path_enc, sessionCtx('entry_path', s.id)),
        })),
        events: events.rows.map(({ path_enc, props_enc, event_uid, ...e }) => ({
          ...e,
          ...decryptEvent({ path_enc, props_enc, event_uid }),
        })),
      })
    } catch (err) {
      console.error('[asknelson] device query failed:', err.message)
      res.status(500).json({ error: 'Failed to load device' })
    }
  })

  router.get('/admin/events.csv', requireAdmin, async (req, res) => {
    try {
      const days = windowDays(req)
      const { rows } = await query(
        `SELECT e.event_uid, e.occurred_at, e.received_at, e.name, e.category, e.path_enc,
                e.device_id, e.session_id, e.props_enc, m.external_ref_hash, m.external_ref_enc
           FROM analytics_events e
           LEFT JOIN analytics_members m ON m.id = e.member_id
          WHERE e.occurred_at > now() - $1::interval
          ORDER BY e.occurred_at DESC
          LIMIT 100000`,
        [`${days} days`]
      )

      const escape = (v) => {
        if (v == null) return ''
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      const header =
        'occurred_at,received_at,name,category,path,device_id,session_id,member_ref,props\n'
      const body = rows
        .map((r) => {
          const { path, props } = decryptEvent(r)
          return [
            r.occurred_at.toISOString(),
            r.received_at.toISOString(),
            r.name,
            r.category,
            path,
            r.device_id,
            r.session_id,
            memberRef(r),
            props,
          ]
            .map(escape)
            .join(',')
        })
        .join('\n')

      // A CSV of decrypted events leaves the system: record that it happened.
      audit(req, { actor: 'admin', action: 'admin_exported_events', details: { days, rows: rows.length } })
      res.set('Content-Type', 'text/csv; charset=utf-8')
      res.set('Cache-Control', 'no-store')
      res.set('Content-Disposition', `attachment; filename="asknelson-events-${days}d.csv"`)
      res.send(header + body)
    } catch (err) {
      console.error('[asknelson] csv export failed:', err.message)
      res.status(500).json({ error: 'Failed to export events' })
    }
  })

  // --- admin: WhatsApp link tokens --------------------------------------------

  /**
   * Mint a link for one member. The raw token is returned exactly once — it is
   * stored only as a hash, so it cannot be recovered later, only re-minted.
   */
  router.post('/admin/link-tokens', requireAdmin, async (req, res) => {
    try {
      const externalRef = str(req.body?.externalRef, 128)
      const label = str(req.body?.label, 128)
      const expiresInDays = int(req.body?.expiresInDays)
      if (!externalRef) return res.status(400).json({ error: 'externalRef is required' })

      const memberId = await upsertMember(externalRef, label)

      // 32 bytes base64url — unguessable, and short enough to keep the
      // WhatsApp message tidy.
      const token = crypto.randomBytes(32).toString('base64url')
      const tokenHash = hashToken(token)
      await query(
        `INSERT INTO analytics_link_tokens (token_hash, member_id, label_enc, expires_at)
         VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4 || ' days')::interval END)`,
        [tokenHash, memberId, seal(label, tokenLabelCtx(tokenHash)), expiresInDays]
      )

      audit(req, { actor: 'admin', action: 'admin_minted_link', targetType: 'member', targetId: memberId })
      res.json({
        token,
        memberId,
        externalRef,
        url: `${baseUrl(req)}/?t=${token}`,
        expiresInDays: expiresInDays ?? null,
      })
    } catch (err) {
      console.error('[asknelson] token mint failed:', err.message)
      res.status(500).json({ error: 'Failed to create link token' })
    }
  })

  router.get('/admin/link-tokens', requireAdmin, async (_req, res) => {
    try {
      const { rows } = await query(
        `SELECT t.token_hash, t.label_enc, t.created_at, t.expires_at, t.revoked_at,
                t.first_used_at, t.last_used_at, t.use_count,
                m.external_ref_hash, m.external_ref_enc,
                (SELECT count(*)::int FROM analytics_devices d WHERE d.member_id = m.id) AS devices
           FROM analytics_link_tokens t
           JOIN analytics_members m ON m.id = t.member_id
          ORDER BY t.created_at DESC
          LIMIT 200`
      )
      res.json({
        tokens: rows.map(({ label_enc, external_ref_hash, external_ref_enc, ...t }) => ({
          ...t,
          label: open(label_enc, tokenLabelCtx(t.token_hash)),
          external_ref: memberRef({ external_ref_hash, external_ref_enc }),
        })),
      })
    } catch (err) {
      console.error('[asknelson] token list failed:', err.message)
      res.status(500).json({ error: 'Failed to load link tokens' })
    }
  })

  router.post('/admin/link-tokens/:hash/revoke', requireAdmin, async (req, res) => {
    try {
      const { rowCount } = await query(
        'UPDATE analytics_link_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
        [req.params.hash]
      )
      if (rowCount === 0) return res.status(404).json({ error: 'Unknown or already revoked token' })
      res.json({ ok: true })
    } catch (err) {
      console.error('[asknelson] token revoke failed:', err.message)
      res.status(500).json({ error: 'Failed to revoke token' })
    }
  })

  return router
}

// Close abandoned sessions on a timer so reporting reflects reality even when
// the client never got to send its session_end.
export function startSessionSweeper(intervalMinutes = 10) {
  if (!isEnabled) return null
  const timer = setInterval(
    () => {
      sweepStaleSessions(30).catch((err) =>
        console.error('[asknelson] session sweep failed:', err.message)
      )
    },
    intervalMinutes * 60 * 1000
  )
  timer.unref()
  return timer
}
