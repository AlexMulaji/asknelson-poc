import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// SQLite store for member identity and event tracking. Kept separate from
// the JSON content store (server/index.js) — different shape, different
// lifecycle. Lives at <dataDir>/asknelson.db, on the same volume as the
// content JSON, so it persists across restarts/rebuilds without a new mount.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  external_ref TEXT,
  token TEXT UNIQUE NOT NULL,
  pseudo_salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_member_id ON sessions(member_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  member_id INTEGER,
  pseudo_id TEXT,
  type TEXT NOT NULL,
  path TEXT,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_member_id ON events(member_id);
`

function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function safeParse(json) {
  try {
    return json ? JSON.parse(json) : null
  } catch {
    return null
  }
}

/**
 * Open (creating on first boot) the member/event SQLite store.
 * `serverSecret` salts the one-way pseudo_id used for sensitive events —
 * never persisted itself, only used to derive the hash at write/query time.
 */
export function openStore(dataDir, serverSecret) {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new Database(path.join(dataDir, 'asknelson.db'))
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  function pseudoId(pseudoSalt) {
    return crypto.createHmac('sha256', serverSecret).update(pseudoSalt).digest('hex')
  }

  const store = {
    // --- members -------------------------------------------------------------
    createMember({ label, externalRef }) {
      const token = randomToken()
      const pseudoSalt = randomToken(16)
      const createdAt = new Date().toISOString()
      const info = db
        .prepare(
          `INSERT INTO members (label, external_ref, token, pseudo_salt, created_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(label, externalRef || null, token, pseudoSalt, createdAt)
      return store.getMember(info.lastInsertRowid)
    },

    getMember(id) {
      return db.prepare('SELECT * FROM members WHERE id = ?').get(id)
    },

    listMembers() {
      return db
        .prepare(
          `SELECT m.id, m.label, m.external_ref, m.token, m.created_at, m.revoked_at,
                  (SELECT MAX(last_seen_at) FROM sessions s WHERE s.member_id = m.id) AS last_seen_at
           FROM members m ORDER BY m.created_at DESC`
        )
        .all()
    },

    revokeMember(id) {
      db.prepare('UPDATE members SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
        new Date().toISOString(),
        id
      )
    },

    getMemberByToken(token) {
      return db.prepare('SELECT * FROM members WHERE token = ? AND revoked_at IS NULL').get(token)
    },

    // --- sessions --------------------------------------------------------------
    createSession(memberId, userAgent) {
      const id = randomToken(24)
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO sessions (id, member_id, created_at, last_seen_at, user_agent)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, memberId, now, now, userAgent || null)
      return id
    },

    // Resolves a session id to its (non-revoked) member, touching last_seen_at.
    // Returns null for an unknown/expired/revoked session.
    resolveSession(sessionId) {
      if (!sessionId) return null
      const row = db
        .prepare(
          `SELECT m.* FROM sessions s
           JOIN members m ON m.id = s.member_id
           WHERE s.id = ? AND m.revoked_at IS NULL`
        )
        .get(sessionId)
      if (!row) return null
      db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        sessionId
      )
      return row
    },

    // --- events ------------------------------------------------------------------
    // Normal events are attributed to member_id directly. `sensitive` events
    // (assessment engagement) are written under a one-way pseudo_id instead —
    // member_id stays NULL so they can never be joined back to a name.
    recordEvent({ sessionId, type, path: eventPath, payload, sensitive }) {
      const member = store.resolveSession(sessionId)
      if (!member) return false
      const memberId = sensitive ? null : member.id
      const pseudo = sensitive ? pseudoId(member.pseudo_salt) : null
      db.prepare(
        `INSERT INTO events (session_id, member_id, pseudo_id, type, path, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        sessionId,
        memberId,
        pseudo,
        String(type).slice(0, 64),
        eventPath ? String(eventPath).slice(0, 256) : null,
        payload ? JSON.stringify(payload).slice(0, 2000) : null,
        new Date().toISOString()
      )
      return true
    },

    eventsSummary() {
      const byType = db
        .prepare('SELECT type, COUNT(*) AS count FROM events GROUP BY type ORDER BY count DESC')
        .all()
      const byPath = db
        .prepare(
          `SELECT path, COUNT(*) AS count FROM events WHERE path IS NOT NULL
           GROUP BY path ORDER BY count DESC LIMIT 20`
        )
        .all()
      const topMembers = db
        .prepare(
          `SELECT m.label, COUNT(*) AS count FROM events e
           JOIN members m ON m.id = e.member_id
           WHERE e.member_id IS NOT NULL
           GROUP BY e.member_id ORDER BY count DESC LIMIT 20`
        )
        .all()
      // Assessment activity — grouped by pseudo_id only, never by member.
      const assessments = db
        .prepare(
          `SELECT pseudo_id, payload, COUNT(*) AS count FROM events
           WHERE type = 'assessment_completed' AND pseudo_id IS NOT NULL
           GROUP BY pseudo_id, payload ORDER BY count DESC LIMIT 50`
        )
        .all()
        .map((row) => ({ ...row, payload: safeParse(row.payload) }))
      return { byType, byPath, topMembers, assessments }
    },
  }

  return store
}
