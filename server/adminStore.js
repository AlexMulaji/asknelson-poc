import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { aad, blindIndex, protect, unprotect } from './crypto.js'

// Where admin accounts, their sessions and their recovery codes live.
//
// Three implementations behind one interface, because the portal runs in three
// situations and the routes should not know which:
//
//   memory    tests — the whole admin auth flow can be exercised, lockouts and
//             session expiry included, with no database in the room
//   file      the no-database mode (plain `npm run dev`, content editing only),
//             persisted next to the content JSON
//   postgres  a real deployment, alongside everything else
//
// The routes deal in plain objects; each store is responsible for protecting
// the email address and the TOTP secret at rest. Passwords arrive already
// hashed — a store never sees one.

/** One admin, as the routers see it. */
function emptyAdmin(fields) {
  return {
    id: crypto.randomUUID(),
    email: null,
    name: null,
    role: 'editor',
    status: 'active',
    passwordHash: null,
    // The shared secret an authenticator app holds. Null until enrolment.
    totpSecret: null,
    totpEnrolledAt: null,
    // Highest TOTP step already accepted — what makes a code single-use.
    totpLastCounter: null,
    failedLogins: 0,
    lockedUntil: null,
    lastLoginAt: null,
    passwordChangedAt: null,
    createdAt: new Date().toISOString(),
    ...fields,
  }
}

export const normaliseEmail = (value) => String(value ?? '').trim().toLowerCase()

const MUTABLE_FIELDS = [
  'email',
  'name',
  'role',
  'status',
  'passwordHash',
  'totpSecret',
  'totpEnrolledAt',
  'totpLastCounter',
  'failedLogins',
  'lockedUntil',
  'lastLoginAt',
  'passwordChangedAt',
]

const SESSION_FIELDS = ['mfaVerified', 'lastSeenAt', 'expiresAt', 'revokedAt']

/**
 * In-memory store. `persist` is called after every mutation, which is all the
 * file store adds on top.
 */
export function createMemoryAdminStore({ persist = () => {}, seed = null } = {}) {
  const admins = new Map(seed?.admins?.map((a) => [a.id, { ...a }]) ?? [])
  const sessions = new Map(seed?.sessions?.map((s) => [s.tokenHash, { ...s }]) ?? [])
  // adminId -> Set of unused recovery code hashes.
  const recovery = new Map(
    Object.entries(seed?.recovery ?? {}).map(([id, codes]) => [id, new Set(codes)])
  )

  const snapshot = () => ({
    admins: [...admins.values()],
    sessions: [...sessions.values()],
    recovery: Object.fromEntries([...recovery].map(([id, codes]) => [id, [...codes]])),
  })
  const save = () => persist(snapshot())
  const clone = (value) => (value ? { ...value } : null)

  return {
    snapshot,

    async countAdmins() {
      return admins.size
    },

    async listAdmins() {
      return [...admins.values()]
        .map(clone)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    },

    async findAdminById(id) {
      return clone(admins.get(id))
    },

    async findAdminByEmail(email) {
      const key = normaliseEmail(email)
      if (!key) return null
      return clone([...admins.values()].find((a) => normaliseEmail(a.email) === key))
    },

    async createAdmin(fields) {
      const email = normaliseEmail(fields.email)
      if ([...admins.values()].some((a) => normaliseEmail(a.email) === email)) {
        throw Object.assign(new Error('An admin with that email already exists'), {
          code: 'DUPLICATE',
        })
      }
      const admin = emptyAdmin({ ...fields, email })
      admins.set(admin.id, admin)
      save()
      return clone(admin)
    },

    async updateAdmin(id, changes) {
      const admin = admins.get(id)
      if (!admin) return null
      for (const field of MUTABLE_FIELDS) {
        if (field in changes) {
          admin[field] = field === 'email' ? normaliseEmail(changes[field]) : changes[field]
        }
      }
      save()
      return clone(admin)
    },

    async deleteAdmin(id) {
      const existed = admins.delete(id)
      for (const [tokenHash, session] of sessions) {
        if (session.adminId === id) sessions.delete(tokenHash)
      }
      recovery.delete(id)
      save()
      return existed
    },

    async createSession(session) {
      // Normalised, so a session looks the same here as it does coming back
      // from Postgres — where an unset column is null, never undefined.
      sessions.set(session.tokenHash, {
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        revokedAt: null,
        mfaVerified: false,
        ...session,
      })
      save()
      return clone(sessions.get(session.tokenHash))
    },

    async findSession(tokenHash) {
      return clone(sessions.get(tokenHash))
    },

    async updateSession(tokenHash, changes) {
      const session = sessions.get(tokenHash)
      if (!session) return null
      for (const field of SESSION_FIELDS) if (field in changes) session[field] = changes[field]
      save()
      return clone(session)
    },

    async revokeSessionsFor(adminId, { except = null } = {}) {
      for (const [tokenHash, session] of sessions) {
        if (session.adminId === adminId && tokenHash !== except) {
          session.revokedAt = new Date().toISOString()
        }
      }
      save()
    },

    async sweepSessions(now = new Date()) {
      let removed = 0
      for (const [tokenHash, session] of sessions) {
        if (new Date(session.expiresAt) < now) {
          sessions.delete(tokenHash)
          removed++
        }
      }
      if (removed) save()
      return removed
    },

    async replaceRecoveryCodes(adminId, hashes) {
      recovery.set(adminId, new Set(hashes))
      save()
    },

    async consumeRecoveryCode(adminId, hash) {
      const codes = recovery.get(adminId)
      if (!codes?.has(hash)) return false
      codes.delete(hash)
      save()
      return true
    },

    async countRecoveryCodes(adminId) {
      return recovery.get(adminId)?.size ?? 0
    },
  }
}

/**
 * The no-database store: the same maps, written to one JSON file after every
 * change. Sessions live in it too, so a restart does not sign every admin out.
 *
 * Written 0600 through a temp file and a rename, so it is never half-written
 * and never world-readable — it holds password hashes and TOTP secrets.
 */
export function createFileAdminStore(filePath) {
  let seed = null
  if (fs.existsSync(filePath)) {
    try {
      seed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (err) {
      throw new Error(`Admin account store at ${filePath} is unreadable: ${err.message}`)
    }
  }

  const persist = (snapshot) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, filePath)
  }

  return createMemoryAdminStore({ persist, seed })
}

// --- postgres -------------------------------------------------------------------

const adminCtx = (column, id) => aad('admin_users', column, id)
export const emailHash = (email) => blindIndex(normaliseEmail(email), 'admin-email')

function rowToAdmin(row) {
  if (!row) return null
  return {
    id: row.id,
    email: unprotect(row.email_protected, adminCtx('email', row.id)),
    name: unprotect(row.name_protected, adminCtx('name', row.id)),
    role: row.role,
    status: row.status,
    passwordHash: row.password_hash,
    totpSecret: unprotect(row.totp_secret_protected, adminCtx('totp_secret', row.id)),
    totpEnrolledAt: row.totp_enrolled_at,
    totpLastCounter: row.totp_last_counter == null ? null : Number(row.totp_last_counter),
    failedLogins: row.failed_logins,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
  }
}

function rowToSession(row) {
  if (!row) return null
  return {
    tokenHash: row.token_hash,
    adminId: row.admin_id,
    mfaVerified: row.mfa_verified,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}

// Mutable admin field -> how it reaches Postgres. Keeping the mapping in one
// table means updateAdmin() can build its SET clause from the caller's keys
// without ever interpolating one of them into SQL.
const ADMIN_COLUMNS = {
  email: {
    column: 'email_protected',
    toDb: (v, id) => protect(normaliseEmail(v), adminCtx('email', id)),
    extra: { email_hash: (v) => emailHash(v) },
  },
  name: { column: 'name_protected', toDb: (v, id) => protect(v, adminCtx('name', id)) },
  role: { column: 'role', toDb: (v) => v },
  status: { column: 'status', toDb: (v) => v },
  passwordHash: { column: 'password_hash', toDb: (v) => v },
  totpSecret: {
    column: 'totp_secret_protected',
    toDb: (v, id) => protect(v, adminCtx('totp_secret', id)),
  },
  totpEnrolledAt: { column: 'totp_enrolled_at', toDb: (v) => v },
  totpLastCounter: { column: 'totp_last_counter', toDb: (v) => v },
  failedLogins: { column: 'failed_logins', toDb: (v) => v },
  lockedUntil: { column: 'locked_until', toDb: (v) => v },
  lastLoginAt: { column: 'last_login_at', toDb: (v) => v },
  passwordChangedAt: { column: 'password_changed_at', toDb: (v) => v },
}

const ADMIN_SELECT = `
  SELECT id, email_protected, name_protected, role, status, password_hash,
         totp_secret_protected, totp_enrolled_at, totp_last_counter,
         failed_logins, locked_until, last_login_at, password_changed_at, created_at
    FROM admin_users`

export function createPostgresAdminStore({ query }) {
  return {
    async countAdmins() {
      const { rows } = await query('SELECT count(*)::int AS count FROM admin_users')
      return rows[0].count
    },

    async listAdmins() {
      const { rows } = await query(`${ADMIN_SELECT} ORDER BY created_at`)
      return rows.map(rowToAdmin)
    },

    async findAdminById(id) {
      const { rows } = await query(`${ADMIN_SELECT} WHERE id = $1`, [id])
      return rowToAdmin(rows[0])
    },

    async findAdminByEmail(email) {
      const hash = emailHash(email)
      if (!hash) return null
      const { rows } = await query(`${ADMIN_SELECT} WHERE email_hash = $1`, [hash])
      return rowToAdmin(rows[0])
    },

    async createAdmin(fields) {
      const id = fields.id ?? crypto.randomUUID()
      const email = normaliseEmail(fields.email)
      try {
        await query(
          `INSERT INTO admin_users
             (id, email_protected, email_hash, name_protected, role, status, password_hash,
              password_changed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
          [
            id,
            protect(email, adminCtx('email', id)),
            emailHash(email),
            protect(fields.name, adminCtx('name', id)),
            fields.role,
            fields.status ?? 'active',
            fields.passwordHash,
          ]
        )
      } catch (err) {
        // 23505 = unique_violation, i.e. that email is already an admin.
        if (err.code === '23505') {
          throw Object.assign(new Error('An admin with that email already exists'), {
            code: 'DUPLICATE',
          })
        }
        throw err
      }
      return this.findAdminById(id)
    },

    async updateAdmin(id, changes) {
      const sets = []
      const params = [id]
      for (const [key, value] of Object.entries(changes)) {
        const spec = ADMIN_COLUMNS[key]
        if (!spec) continue
        params.push(spec.toDb(value, id))
        sets.push(`${spec.column} = $${params.length}`)
        for (const [column, derive] of Object.entries(spec.extra ?? {})) {
          params.push(derive(value))
          sets.push(`${column} = $${params.length}`)
        }
      }
      if (sets.length === 0) return this.findAdminById(id)
      await query(`UPDATE admin_users SET ${sets.join(', ')} WHERE id = $1`, params)
      return this.findAdminById(id)
    },

    async deleteAdmin(id) {
      const { rowCount } = await query('DELETE FROM admin_users WHERE id = $1', [id])
      return rowCount > 0
    },

    async createSession(session) {
      await query(
        `INSERT INTO admin_sessions (token_hash, admin_id, mfa_verified, expires_at, user_agent_protected)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          session.tokenHash,
          session.adminId,
          session.mfaVerified,
          session.expiresAt,
          protect(session.userAgent, aad('admin_sessions', 'user_agent', session.tokenHash)),
        ]
      )
      return this.findSession(session.tokenHash)
    },

    async findSession(tokenHash) {
      const { rows } = await query(
        `SELECT token_hash, admin_id, mfa_verified, created_at, last_seen_at, expires_at, revoked_at
           FROM admin_sessions WHERE token_hash = $1`,
        [tokenHash]
      )
      return rowToSession(rows[0])
    },

    async updateSession(tokenHash, changes) {
      const columns = {
        mfaVerified: 'mfa_verified',
        lastSeenAt: 'last_seen_at',
        expiresAt: 'expires_at',
        revokedAt: 'revoked_at',
      }
      const sets = []
      const params = [tokenHash]
      for (const [key, column] of Object.entries(columns)) {
        if (!(key in changes)) continue
        params.push(changes[key])
        sets.push(`${column} = $${params.length}`)
      }
      if (sets.length === 0) return this.findSession(tokenHash)
      await query(`UPDATE admin_sessions SET ${sets.join(', ')} WHERE token_hash = $1`, params)
      return this.findSession(tokenHash)
    },

    async revokeSessionsFor(adminId, { except = null } = {}) {
      await query(
        `UPDATE admin_sessions SET revoked_at = now()
          WHERE admin_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR token_hash <> $2)`,
        [adminId, except]
      )
    },

    async sweepSessions() {
      const { rowCount } = await query('DELETE FROM admin_sessions WHERE expires_at < now()')
      return rowCount
    },

    async replaceRecoveryCodes(adminId, hashes) {
      await query('DELETE FROM admin_recovery_codes WHERE admin_id = $1', [adminId])
      for (const hash of hashes) {
        await query('INSERT INTO admin_recovery_codes (id, admin_id, code_hash) VALUES ($1,$2,$3)', [
          crypto.randomUUID(),
          adminId,
          hash,
        ])
      }
    },

    async consumeRecoveryCode(adminId, hash) {
      // Consumed by the UPDATE itself, so two simultaneous uses of one code
      // cannot both succeed.
      const { rowCount } = await query(
        `UPDATE admin_recovery_codes SET used_at = now()
          WHERE admin_id = $1 AND code_hash = $2 AND used_at IS NULL`,
        [adminId, hash]
      )
      return rowCount > 0
    },

    async countRecoveryCodes(adminId) {
      const { rows } = await query(
        'SELECT count(*)::int AS count FROM admin_recovery_codes WHERE admin_id = $1 AND used_at IS NULL',
        [adminId]
      )
      return rows[0].count
    },
  }
}
