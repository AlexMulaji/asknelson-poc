import express from 'express'
import crypto from 'node:crypto'
import { isEnabled, query, sweepStaleSessions } from './db.js'

// Event tracking: ingest from the PWA, plus the admin read/export API.
//
// The chain is device -> session -> event. The device id is minted in the
// browser and mirrored to a first-party cookie; a WhatsApp link token (?t=…)
// binds that device to a member, so every event can be traced back to a person
// without ever putting an identifier in the URL beyond the opaque token.

const DEVICE_COOKIE = 'an_did'
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
}

// --- helpers ------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
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

function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
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

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  const proto = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol
  return `${proto}://${req.get('host')}`
}

// Small fixed-window limiter, per IP. Enough to stop an accidental retry storm
// or a bored user hammering the endpoint; it is not a defence against a
// distributed flood — put a real proxy in front for that.
function rateLimiter({ windowMs, max }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip || 'unknown'
    const entry = hits.get(key)
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
    } else if (++entry.count > max) {
      return res.status(429).json({ error: 'Too many requests' })
    }
    // Opportunistic cleanup so the map cannot grow without bound.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k)
    }
    next()
  }
}

// --- token / member linking ---------------------------------------------------

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
      const cookieId = readCookie(req, DEVICE_COOKIE)
      const deviceId = isUuid(body.deviceId)
        ? body.deviceId
        : isUuid(cookieId)
          ? cookieId
          : crypto.randomUUID()

      const sessionId = isUuid(body.sessionId) ? body.sessionId : crypto.randomUUID()
      const userAgent = str(req.get('user-agent'), MAX_TEXT_LEN)
      const isWhatsapp = Boolean(ctx.isWhatsapp) || /WhatsApp/i.test(userAgent || '')
      const utm = sanitiseProps(ctx.utm)

      await query(
        `INSERT INTO analytics_devices
           (id, user_agent, platform, language, timezone, screen_w, screen_h,
            display_mode, is_whatsapp, first_referrer, first_landing_path, first_utm)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET
           last_seen_at       = now(),
           user_agent         = EXCLUDED.user_agent,
           platform           = EXCLUDED.platform,
           language           = EXCLUDED.language,
           timezone           = EXCLUDED.timezone,
           screen_w           = EXCLUDED.screen_w,
           screen_h           = EXCLUDED.screen_h,
           display_mode       = EXCLUDED.display_mode,
           is_whatsapp        = analytics_devices.is_whatsapp OR EXCLUDED.is_whatsapp,
           -- "first_*" columns record acquisition and must never be overwritten.
           first_referrer     = COALESCE(analytics_devices.first_referrer, EXCLUDED.first_referrer),
           first_landing_path = COALESCE(analytics_devices.first_landing_path, EXCLUDED.first_landing_path),
           first_utm          = COALESCE(analytics_devices.first_utm, EXCLUDED.first_utm)`,
        [
          deviceId,
          userAgent,
          str(ctx.platform, 128),
          str(ctx.language, 32),
          str(ctx.timezone, 64),
          int(ctx.screenW),
          int(ctx.screenH),
          str(ctx.displayMode, 32),
          isWhatsapp,
          str(ctx.referrer, MAX_PATH_LEN),
          str(ctx.path, MAX_PATH_LEN),
          Object.keys(utm).length ? JSON.stringify(utm) : null,
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
           (id, device_id, member_id, source, entry_path, referrer, utm,
            display_mode, user_agent, is_whatsapp)
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
          str(ctx.path, MAX_PATH_LEN),
          str(ctx.referrer, MAX_PATH_LEN),
          Object.keys(utm).length ? JSON.stringify(utm) : null,
          str(ctx.displayMode, 32),
          userAgent,
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
        secure: req.secure || req.get('x-forwarded-proto') === 'https',
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
      const deviceId = isUuid(body.deviceId) ? body.deviceId : null
      const sessionId = isUuid(body.sessionId) ? body.sessionId : null
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
      let i = 0
      for (const event of events) {
        const name = str(event?.name, MAX_NAME_LEN)
        if (!name) continue
        values.push(
          `($${++i},$${++i},$${++i},$${++i},$${++i},$${++i},$${++i},$${++i}::jsonb,$${++i},$${++i})`
        )
        params.push(
          isUuid(event.uid) ? event.uid : crypto.randomUUID(),
          sessionId,
          deviceId,
          memberId,
          name,
          EVENT_CATEGORIES[name] || 'custom',
          str(event.path, MAX_PATH_LEN),
          JSON.stringify(sanitiseProps(event.props)),
          clampTimestamp(event.at),
          int(event.seq)
        )
      }

      if (values.length === 0) return res.status(400).json({ error: 'No valid events' })

      const { rowCount } = await query(
        `INSERT INTO analytics_events
           (event_uid, session_id, device_id, member_id, name, category, path, props, occurred_at, client_seq)
         VALUES ${values.join(',')}
         ON CONFLICT (event_uid) DO NOTHING`,
        params
      )

      // A session_end event closes the session there and then, rather than
      // waiting for the idle sweeper to notice.
      const ended = events.some((e) => e?.name === 'session_end')
      await query(
        `UPDATE analytics_sessions
            SET last_seen_at = now(),
                event_count  = event_count + $2,
                ended_at     = CASE WHEN $3 THEN now() ELSE ended_at END
          WHERE id = $1`,
        [sessionId, rowCount, ended]
      )
      await query(
        'UPDATE analytics_devices SET last_seen_at = now(), event_count = event_count + $2 WHERE id = $1',
        [deviceId, rowCount]
      )

      res.json({ ok: true, accepted: rowCount })
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
        query(
          `SELECT props->>'title' AS title,
                  props->>'theme' AS theme,
                  count(*)::int AS opens
             FROM analytics_events
            WHERE name = 'content_opened'
              AND occurred_at > now() - $1::interval
              AND props->>'title' IS NOT NULL
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
                s.source, s.entry_path, s.is_whatsapp, s.event_count,
                m.external_ref, m.label AS member_label
           FROM analytics_sessions s
           LEFT JOIN analytics_members m ON m.id = s.member_id
          ORDER BY s.started_at DESC
          LIMIT $1 OFFSET $2`,
        [limit, offset]
      )
      res.json({ sessions: rows, limit, offset })
    } catch (err) {
      console.error('[asknelson] sessions query failed:', err.message)
      res.status(500).json({ error: 'Failed to load sessions' })
    }
  })

  // Everything one device has ever done — the "what did this person see?" view.
  router.get('/admin/devices/:id', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params
      if (!isUuid(id)) return res.status(400).json({ error: 'Invalid device id' })

      const [device, sessions, events] = await Promise.all([
        query(
          `SELECT d.*, m.external_ref, m.label AS member_label
             FROM analytics_devices d
             LEFT JOIN analytics_members m ON m.id = d.member_id
            WHERE d.id = $1`,
          [id]
        ),
        query(
          `SELECT id, started_at, last_seen_at, ended_at, source, entry_path, event_count
             FROM analytics_sessions
            WHERE device_id = $1
            ORDER BY started_at DESC
            LIMIT 50`,
          [id]
        ),
        query(
          `SELECT id, session_id, name, category, path, props, occurred_at
             FROM analytics_events
            WHERE device_id = $1
            ORDER BY occurred_at DESC
            LIMIT 500`,
          [id]
        ),
      ])

      if (device.rows.length === 0) return res.status(404).json({ error: 'Unknown device' })
      res.json({ device: device.rows[0], sessions: sessions.rows, events: events.rows })
    } catch (err) {
      console.error('[asknelson] device query failed:', err.message)
      res.status(500).json({ error: 'Failed to load device' })
    }
  })

  router.get('/admin/events.csv', requireAdmin, async (req, res) => {
    try {
      const days = windowDays(req)
      const { rows } = await query(
        `SELECT e.occurred_at, e.received_at, e.name, e.category, e.path,
                e.device_id, e.session_id, m.external_ref, e.props
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
        .map((r) =>
          [
            r.occurred_at.toISOString(),
            r.received_at.toISOString(),
            r.name,
            r.category,
            r.path,
            r.device_id,
            r.session_id,
            r.external_ref,
            r.props,
          ]
            .map(escape)
            .join(',')
        )
        .join('\n')

      res.set('Content-Type', 'text/csv; charset=utf-8')
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

      const { rows: memberRows } = await query(
        `INSERT INTO analytics_members (id, external_ref, label)
         VALUES ($1, $2, $3)
         ON CONFLICT (external_ref) DO UPDATE SET label = COALESCE(EXCLUDED.label, analytics_members.label)
         RETURNING id`,
        [crypto.randomUUID(), externalRef, label]
      )
      const memberId = memberRows[0].id

      // 32 bytes base64url — unguessable, and short enough to keep the
      // WhatsApp message tidy.
      const token = crypto.randomBytes(32).toString('base64url')
      await query(
        `INSERT INTO analytics_link_tokens (token_hash, member_id, label, expires_at)
         VALUES ($1, $2, $3, CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4 || ' days')::interval END)`,
        [hashToken(token), memberId, label, expiresInDays]
      )

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
        `SELECT t.token_hash, t.label, t.created_at, t.expires_at, t.revoked_at,
                t.first_used_at, t.last_used_at, t.use_count,
                m.external_ref,
                (SELECT count(*)::int FROM analytics_devices d WHERE d.member_id = m.id) AS devices
           FROM analytics_link_tokens t
           JOIN analytics_members m ON m.id = t.member_id
          ORDER BY t.created_at DESC
          LIMIT 200`
      )
      res.json({ tokens: rows })
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
