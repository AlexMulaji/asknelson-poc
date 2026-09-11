import fs from 'node:fs'
import pg from 'pg'
import m003 from './migrations/003_popia_encryption.js'

// Postgres connection + schema migrations for accounts, progress and analytics.
//
// The database is OPTIONAL: with no DATABASE_URL the app runs exactly as
// before — the tracking endpoints return 204, sign-in is hidden, progress stays
// on the device, and the admin analytics tab shows a notice. That keeps
// `npm run dev` and offline PWA use working with zero infra.

const { Pool } = pg

const DATABASE_URL = process.env.DATABASE_URL || ''
const SSL_MODE = (process.env.DATABASE_SSL || '').toLowerCase()

export const isEnabled = Boolean(DATABASE_URL)

// Encryption in transit between the app and Postgres (POPIA s19).
//   verify-full  TLS, and the server certificate is checked against the system
//                roots or DATABASE_SSL_CA_FILE. Use this in production.
//   require      TLS without certificate checks: encrypted, but open to a
//                man-in-the-middle. A stopgap for a managed host whose CA
//                bundle you haven't fetched yet.
//   disable      Plaintext. Only for a database on the same private network as
//                the app, like the compose file's internal network.
// Unset defers to sslmode= in DATABASE_URL.
function sslConfig() {
  if (SSL_MODE === 'disable') return false
  if (SSL_MODE === 'require') return { rejectUnauthorized: false }
  if (SSL_MODE === 'verify-full') {
    const caFile = process.env.DATABASE_SSL_CA_FILE
    return { rejectUnauthorized: true, ...(caFile ? { ca: fs.readFileSync(caFile, 'utf8') } : {}) }
  }
  return undefined
}

if (isEnabled && SSL_MODE === 'require') {
  console.warn(
    '[asknelson] DATABASE_SSL=require encrypts but does not verify the server certificate. ' +
      'Use DATABASE_SSL=verify-full (with DATABASE_SSL_CA_FILE if needed) in production.'
  )
}

// `timestamptz` comes back as a JS Date by default, which JSON-serialises to
// UTC ISO strings — exactly what the admin UI and CSV export want.
export const pool = isEnabled
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: sslConfig(),
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null

if (pool) {
  // A dead backend connection must never take the whole process down; the pool
  // discards the client and the next query opens a fresh one.
  pool.on('error', (err) => {
    console.error('[asknelson] idle postgres client error:', err.message)
  })
}

export function query(text, params) {
  if (!pool) throw new Error('Analytics database is not configured')
  return pool.query(text, params)
}

/** Run `fn(client)` inside BEGIN/COMMIT, rolling back if it throws. */
export async function withTransaction(fn) {
  if (!pool) throw new Error('Database is not configured')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

// --- schema -------------------------------------------------------------------

// Applied in order, each inside a transaction, tracked in _analytics_migrations
// so restarts and redeploys are no-ops. Never edit a shipped migration — add a
// new one, or existing databases will silently drift from new ones.
//
// A migration is { name, sql?, run?(client), after?: string[] }: `sql` for
// schema, `run` for data work that needs code (re-encrypting existing rows),
// `after` for maintenance that can't run in a transaction (VACUUM FULL).
const MIGRATIONS = [
  {
    name: '001_initial',
    sql: `
      -- A person, as known to whatever system sends the WhatsApp message.
      -- external_ref is your member/employee identifier; no PII is required.
      CREATE TABLE IF NOT EXISTS analytics_members (
        id            uuid PRIMARY KEY,
        external_ref  text UNIQUE,
        label         text,
        created_at    timestamptz NOT NULL DEFAULT now()
      );

      -- Opaque tokens handed out in WhatsApp links (…/?t=<token>).
      -- Only the SHA-256 hash is stored: a leaked database cannot be used to
      -- forge working links, and the raw token is shown once at mint time.
      CREATE TABLE IF NOT EXISTS analytics_link_tokens (
        token_hash    text PRIMARY KEY,
        member_id     uuid NOT NULL REFERENCES analytics_members(id) ON DELETE CASCADE,
        label         text,
        created_at    timestamptz NOT NULL DEFAULT now(),
        expires_at    timestamptz,
        revoked_at    timestamptz,
        first_used_at timestamptz,
        last_used_at  timestamptz,
        use_count     integer NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS analytics_link_tokens_member_idx
        ON analytics_link_tokens (member_id);

      -- One row per browser profile. id is generated client-side and kept in
      -- localStorage, mirrored to a first-party cookie so either one surviving
      -- keeps the device recognisable.
      CREATE TABLE IF NOT EXISTS analytics_devices (
        id                 uuid PRIMARY KEY,
        member_id          uuid REFERENCES analytics_members(id) ON DELETE SET NULL,
        first_seen_at      timestamptz NOT NULL DEFAULT now(),
        last_seen_at       timestamptz NOT NULL DEFAULT now(),
        linked_at          timestamptz,
        user_agent         text,
        platform           text,
        language           text,
        timezone           text,
        screen_w           integer,
        screen_h           integer,
        display_mode       text,
        is_whatsapp        boolean NOT NULL DEFAULT false,
        first_referrer     text,
        first_landing_path text,
        first_utm          jsonb,
        session_count      integer NOT NULL DEFAULT 0,
        event_count        integer NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS analytics_devices_member_idx
        ON analytics_devices (member_id);
      CREATE INDEX IF NOT EXISTS analytics_devices_last_seen_idx
        ON analytics_devices (last_seen_at DESC);

      -- A visit. Closed by 30 minutes of inactivity (client-side) or by the
      -- sweeper below, so "sessions today" stays meaningful.
      CREATE TABLE IF NOT EXISTS analytics_sessions (
        id            uuid PRIMARY KEY,
        device_id     uuid NOT NULL REFERENCES analytics_devices(id) ON DELETE CASCADE,
        member_id     uuid REFERENCES analytics_members(id) ON DELETE SET NULL,
        started_at    timestamptz NOT NULL DEFAULT now(),
        last_seen_at  timestamptz NOT NULL DEFAULT now(),
        ended_at      timestamptz,
        source        text,
        entry_path    text,
        referrer      text,
        utm           jsonb,
        display_mode  text,
        user_agent    text,
        is_whatsapp   boolean NOT NULL DEFAULT false,
        event_count   integer NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS analytics_sessions_device_idx
        ON analytics_sessions (device_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS analytics_sessions_member_idx
        ON analytics_sessions (member_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS analytics_sessions_started_idx
        ON analytics_sessions (started_at DESC);

      -- The event stream. device_id and member_id are denormalised onto every
      -- row so the common "everything this device/person did" query needs no
      -- join, and so events survive independently of session bookkeeping.
      CREATE TABLE IF NOT EXISTS analytics_events (
        id           bigserial PRIMARY KEY,
        event_uid    uuid NOT NULL UNIQUE,
        session_id   uuid NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
        device_id    uuid NOT NULL REFERENCES analytics_devices(id) ON DELETE CASCADE,
        member_id    uuid REFERENCES analytics_members(id) ON DELETE SET NULL,
        name         text NOT NULL,
        category     text,
        path         text,
        props        jsonb NOT NULL DEFAULT '{}'::jsonb,
        occurred_at  timestamptz NOT NULL,
        received_at  timestamptz NOT NULL DEFAULT now(),
        client_seq   integer
      );
      CREATE INDEX IF NOT EXISTS analytics_events_device_idx
        ON analytics_events (device_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS analytics_events_session_idx
        ON analytics_events (session_id, client_seq);
      CREATE INDEX IF NOT EXISTS analytics_events_name_idx
        ON analytics_events (name, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS analytics_events_member_idx
        ON analytics_events (member_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS analytics_events_occurred_idx
        ON analytics_events (occurred_at DESC);
    `,
  },
  {
    name: '002_auth',
    sql: `
      -- Accounts. Two kinds, distinguished by is_anonymous:
      --
      --   identified — name, ID number and contact details are retained.
      --   anonymous  — username + password only. Contact details are held just
      --                long enough to deliver the OTP, then nulled on
      --                verification, leaving only a peppered hash for duplicate
      --                detection. That hash is one-way and is never joined to
      --                analytics, so the promise made at sign-up ("even we
      --                can't link your activity back to you") holds
      --                structurally, not merely by convention.
      CREATE TABLE IF NOT EXISTS auth_users (
        id              uuid PRIMARY KEY,
        is_anonymous    boolean NOT NULL,
        username        text UNIQUE,
        password_hash   text NOT NULL,

        -- Retained for identified accounts only; nulled for anonymous accounts
        -- the moment verification succeeds.
        email           text,
        phone           text,
        first_name      text,
        last_name       text,

        -- HMAC-SHA256 keyed with AUTH_PEPPER. Lets us spot a repeat sign-up
        -- without storing the value, and is what anonymous accounts are
        -- de-duplicated against.
        email_hash      text,
        phone_hash      text,
        id_number_hash  text,

        employer        text,
        employee_no     text,

        status          text NOT NULL DEFAULT 'pending',
        created_at      timestamptz NOT NULL DEFAULT now(),
        verified_at     timestamptz,
        last_login_at   timestamptz,
        failed_logins   integer NOT NULL DEFAULT 0,
        locked_until    timestamptz,

        -- Set for identified accounts so their events attribute to a member.
        -- Forced NULL for anonymous accounts by the constraint below.
        member_id       uuid REFERENCES analytics_members(id) ON DELETE SET NULL,

        CONSTRAINT auth_users_status_chk CHECK (status IN ('pending','active','disabled')),
        -- The anonymity guarantee, enforced by the database rather than trusted
        -- to application code: an anonymous row can never carry a member link
        -- or a retained real-world identity.
        CONSTRAINT auth_users_anon_unlinked_chk CHECK (
          NOT is_anonymous OR (
            member_id IS NULL AND first_name IS NULL AND last_name IS NULL
            AND id_number_hash IS NULL
          )
        )
      );
      CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_hash_idx
        ON auth_users (email_hash) WHERE email_hash IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS auth_users_phone_hash_idx
        ON auth_users (phone_hash) WHERE phone_hash IS NOT NULL;
      CREATE INDEX IF NOT EXISTS auth_users_member_idx ON auth_users (member_id);

      -- One-time PINs. Only the hash is stored, so a database read cannot be
      -- used to complete somebody else's verification.
      CREATE TABLE IF NOT EXISTS auth_otp_codes (
        id           uuid PRIMARY KEY,
        user_id      uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        code_hash    text NOT NULL,
        purpose      text NOT NULL DEFAULT 'verify',
        channel      text NOT NULL,
        destination  text,
        attempts     integer NOT NULL DEFAULT 0,
        expires_at   timestamptz NOT NULL,
        consumed_at  timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS auth_otp_user_idx
        ON auth_otp_codes (user_id, created_at DESC);

      -- Server-side sessions. The cookie carries a random token; only its hash
      -- lives here, so a stolen database cannot be used to mint a valid cookie.
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash   text PRIMARY KEY,
        user_id      uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        created_at   timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at   timestamptz NOT NULL,
        revoked_at   timestamptz,
        user_agent   text
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);
    `,
  },
  // Encrypts personal information at rest and adds consent, audit, password
  // reset and progress tables. See server/migrations/003_popia_encryption.js.
  m003,
]

export async function migrate() {
  if (!pool) return

  await pool.query(`
    CREATE TABLE IF NOT EXISTS _analytics_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)

  const { rows } = await pool.query('SELECT name FROM _analytics_migrations')
  const applied = new Set(rows.map((r) => r.name))

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      if (migration.sql) await client.query(migration.sql)
      if (migration.run) await migration.run(client)
      await client.query('INSERT INTO _analytics_migrations (name) VALUES ($1)', [migration.name])
      await client.query('COMMIT')
      console.log(`[asknelson] applied migration ${migration.name}`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    // The schema change is committed by now, so a failure here is logged
    // rather than fatal.
    for (const statement of migration.after ?? []) {
      await pool
        .query(statement)
        .catch((err) => console.warn(`[asknelson] "${statement}" failed:`, err.message))
    }
  }
}

// POPIA s14: personal information may not be kept longer than its purpose
// needs. Raw events, sessions and long-idle devices age out; the de-identified
// analytics_daily_counts are kept. 0 keeps forever.
const ANALYTICS_RETENTION_DAYS = Number(process.env.ANALYTICS_RETENTION_DAYS ?? 730)
const AUDIT_RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? 1825)

export async function sweepRetention() {
  if (!pool) return
  if (ANALYTICS_RETENTION_DAYS > 0) {
    const window = `${ANALYTICS_RETENTION_DAYS} days`
    await pool.query('DELETE FROM analytics_events WHERE occurred_at < now() - $1::interval', [window])
    await pool.query('DELETE FROM analytics_sessions WHERE started_at < now() - $1::interval', [window])
    // Cascades to anything left on the device, acquisition details included.
    await pool.query('DELETE FROM analytics_devices WHERE last_seen_at < now() - $1::interval', [window])
  }
  if (AUDIT_RETENTION_DAYS > 0) {
    await pool.query('DELETE FROM audit_log WHERE occurred_at < now() - $1::interval', [
      `${AUDIT_RETENTION_DAYS} days`,
    ])
  }
}

// Close sessions that stopped sending events. Without this, a session the user
// abandoned (closed the tab mid-visit, phone died) would stay open forever and
// inflate "active now" style numbers.
export async function sweepStaleSessions(idleMinutes = 30) {
  if (!pool) return 0
  const { rowCount } = await pool.query(
    `UPDATE analytics_sessions
        SET ended_at = last_seen_at
      WHERE ended_at IS NULL
        AND last_seen_at < now() - ($1 || ' minutes')::interval`,
    [String(idleMinutes)]
  )
  return rowCount
}

export async function close() {
  if (pool) await pool.end()
}
