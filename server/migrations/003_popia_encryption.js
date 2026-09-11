import crypto from 'node:crypto'
import { aad, blindIndex, seal, sealJson } from '../crypto.js'
import { maskDestination } from '../otp.js'
import { ROLLUP_DIMENSIONS } from '../rollups.js'

// 003 — POPIA: encrypt personal information at rest, add consent, audit,
// password reset and server-side progress.
//
// Runs in three phases inside the migration's single transaction:
//   1. add the new *_enc columns and tables
//   2. seal every existing plaintext value into them (and seed the
//      de-identified rollups from the plaintext event props while we still
//      can read them)
//   3. drop the plaintext columns
// then, after COMMIT, VACUUM FULL the touched tables. DROP COLUMN only hides a
// column — the bytes stay in the heap until the table is rewritten, and a
// rewrite nulls dropped columns out. Old WAL and any backup taken before this
// migration still hold plaintext: rotate them out (see docs/DATABASE.md).

const BATCH = 500

const ADD_STRUCTURE = `
  -- Employers. A company name is not personal information on its own, and a
  -- plain FK lets EAP reporting aggregate per employer without decrypting a
  -- single user row.
  CREATE TABLE organisations (
    id          uuid PRIMARY KEY,
    name        text NOT NULL,
    name_key    text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE auth_users
    ADD COLUMN email_enc            bytea,
    ADD COLUMN phone_enc            bytea,
    ADD COLUMN first_name_enc       bytea,
    ADD COLUMN last_name_enc        bytea,
    ADD COLUMN employee_no_enc      bytea,
    ADD COLUMN organisation_id      uuid REFERENCES organisations(id) ON DELETE SET NULL,
    ADD COLUMN password_changed_at  timestamptz;

  ALTER TABLE auth_otp_codes ADD COLUMN destination_masked text;

  ALTER TABLE auth_sessions
    ADD COLUMN persistent      boolean NOT NULL DEFAULT true,
    ADD COLUMN user_agent_enc  bytea;

  ALTER TABLE analytics_members
    ADD COLUMN external_ref_hash  text,
    ADD COLUMN external_ref_enc   bytea,
    ADD COLUMN label_enc          bytea;

  ALTER TABLE analytics_link_tokens ADD COLUMN label_enc bytea;

  ALTER TABLE analytics_devices
    ADD COLUMN user_agent_enc          bytea,
    ADD COLUMN first_referrer_enc      bytea,
    ADD COLUMN first_landing_path_enc  bytea,
    ADD COLUMN first_utm_enc           bytea;

  ALTER TABLE analytics_sessions
    ADD COLUMN entry_path_enc  bytea,
    ADD COLUMN referrer_enc    bytea,
    ADD COLUMN utm_enc         bytea,
    ADD COLUMN user_agent_enc  bytea;

  ALTER TABLE analytics_events
    ADD COLUMN path_enc   bytea,
    ADD COLUMN props_enc  bytea;

  -- De-identified daily counts: no device, session or member ids. Survives the
  -- raw-event retention sweep. dims = '{}' is the day's total for that event.
  CREATE TABLE analytics_daily_counts (
    day         date NOT NULL,
    event_name  text NOT NULL,
    dims        jsonb NOT NULL DEFAULT '{}'::jsonb,
    count       integer NOT NULL DEFAULT 0,
    PRIMARY KEY (day, event_name, dims)
  );
`

const DROP_PLAINTEXT = `
  ALTER TABLE auth_users DROP CONSTRAINT IF EXISTS auth_users_anon_unlinked_chk;
  ALTER TABLE auth_users
    DROP COLUMN email,
    DROP COLUMN phone,
    DROP COLUMN first_name,
    DROP COLUMN last_name,
    DROP COLUMN employee_no,
    DROP COLUMN employer;
  -- The anonymity guarantee, restated over the encrypted columns: an anonymous
  -- row can never carry a member link or a retained real-world identity.
  ALTER TABLE auth_users ADD CONSTRAINT auth_users_anon_unlinked_chk CHECK (
    NOT is_anonymous OR (
      member_id IS NULL AND first_name_enc IS NULL AND last_name_enc IS NULL
      AND id_number_hash IS NULL
    )
  );
  CREATE INDEX auth_users_id_number_hash_idx
    ON auth_users (id_number_hash) WHERE id_number_hash IS NOT NULL;
  CREATE INDEX auth_users_organisation_idx ON auth_users (organisation_id);

  ALTER TABLE auth_otp_codes DROP COLUMN destination;
  ALTER TABLE auth_sessions DROP COLUMN user_agent;

  ALTER TABLE analytics_members DROP COLUMN external_ref, DROP COLUMN label;
  ALTER TABLE analytics_members ALTER COLUMN external_ref_hash SET NOT NULL;
  CREATE UNIQUE INDEX analytics_members_ref_hash_idx ON analytics_members (external_ref_hash);

  ALTER TABLE analytics_link_tokens DROP COLUMN label;

  ALTER TABLE analytics_devices
    DROP COLUMN user_agent,
    DROP COLUMN first_referrer,
    DROP COLUMN first_landing_path,
    DROP COLUMN first_utm;

  ALTER TABLE analytics_sessions
    DROP COLUMN entry_path,
    DROP COLUMN referrer,
    DROP COLUMN utm,
    DROP COLUMN user_agent;

  ALTER TABLE analytics_events DROP COLUMN path, DROP COLUMN props;
  ALTER TABLE analytics_events ALTER COLUMN props_enc SET NOT NULL;
`

const NEW_TABLES = `
  -- Password reset links. Only the token's hash is stored; single use, short
  -- lived, and every outstanding link dies when one is used.
  CREATE TABLE auth_password_resets (
    id                  uuid PRIMARY KEY,
    user_id             uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash          text NOT NULL UNIQUE,
    channel             text NOT NULL CHECK (channel IN ('sms', 'email')),
    destination_masked  text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    consumed_at         timestamptz
  );
  CREATE INDEX auth_password_resets_user_idx ON auth_password_resets (user_id, created_at DESC);

  -- POPIA s11 / s27 consent, append-only: a withdrawal is a new row with
  -- granted = false, so the history of what was agreed to, and when, is kept.
  CREATE TABLE user_consents (
    id              uuid PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    purpose         text NOT NULL,
    notice_version  text NOT NULL,
    granted         boolean NOT NULL,
    source          text NOT NULL DEFAULT 'registration',
    recorded_at     timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX user_consents_user_idx ON user_consents (user_id, purpose, recorded_at DESC);

  -- Security audit trail. actor_id has no FK on purpose: the trail must
  -- outlive a deleted account. ip_hash is keyed; details are sealed.
  CREATE TABLE audit_log (
    id           bigserial PRIMARY KEY,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    actor_type   text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'anonymous')),
    actor_id     uuid,
    action       text NOT NULL,
    target_type  text,
    target_id    text,
    ip_hash      text,
    details_enc  bytea
  );
  CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);
  CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, occurred_at DESC);
  CREATE INDEX audit_log_action_idx ON audit_log (action, occurred_at DESC);

  -- ---- Progress: "continue where you left off" ------------------------------
  --
  -- Which journey or assessment someone is doing reveals their mental-health
  -- concerns — special personal information (POPIA s26). So the item id itself
  -- is sealed, and rows are found by a per-user blind index (HMAC of
  -- user id + item id): the database can't tell which journey a row is, nor
  -- that two users are on the same one.

  CREATE TABLE user_journey_progress (
    user_id           uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    journey_key       text NOT NULL,
    state_enc         bytea NOT NULL,             -- { journeyId, completedDays[] }
    is_active         boolean NOT NULL DEFAULT false,
    status            text NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'completed')),
    days_completed    smallint NOT NULL DEFAULT 0,
    total_days        smallint,
    started_at        timestamptz NOT NULL DEFAULT now(),
    last_activity_at  timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz,
    PRIMARY KEY (user_id, journey_key)
  );
  -- At most one active journey per person, enforced by the database.
  CREATE UNIQUE INDEX user_journey_progress_active_idx
    ON user_journey_progress (user_id) WHERE is_active;

  -- Score / band history. Raw answers are never stored anywhere.
  CREATE TABLE user_assessment_results (
    id              uuid PRIMARY KEY,
    user_id         uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    assessment_key  text NOT NULL,
    result_enc      bytea NOT NULL,               -- { assessmentId, score, band }
    taken_at        timestamptz NOT NULL,
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, assessment_key, taken_at)
  );

  CREATE TABLE user_meditation_sessions (
    id           uuid PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    planned_sec  integer NOT NULL CHECK (planned_sec > 0),
    elapsed_sec  integer NOT NULL CHECK (elapsed_sec >= 0),
    sound        text,
    completed    boolean NOT NULL,
    ended_at     timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX user_meditation_sessions_user_idx ON user_meditation_sessions (user_id, ended_at DESC);

  -- Articles and videos opened, for "continue reading" / recently viewed.
  CREATE TABLE user_content_activity (
    user_id          uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    content_key      text NOT NULL,
    content_enc      bytea NOT NULL,              -- { contentId, title, url, themeId, type }
    open_count       integer NOT NULL DEFAULT 1,
    first_opened_at  timestamptz NOT NULL DEFAULT now(),
    last_opened_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, content_key)
  );
  CREATE INDEX user_content_activity_recent_idx ON user_content_activity (user_id, last_opened_at DESC);

  -- Where the user was, and their preferences. A route like
  -- /my-wellness?journey=grief is as revealing as the journey itself.
  CREATE TABLE user_app_state (
    user_id          uuid PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    last_route_enc   bytea,
    preferences_enc  bytea,
    updated_at       timestamptz NOT NULL DEFAULT now()
  );
`

const orgKey = (name) => name.toLowerCase().replace(/\s+/g, ' ').trim()

async function upsertOrganisation(client, name) {
  const { rows } = await client.query(
    `INSERT INTO organisations (id, name, name_key) VALUES ($1, $2, $3)
     ON CONFLICT (name_key) DO UPDATE SET name = organisations.name
     RETURNING id`,
    [crypto.randomUUID(), name.trim(), orgKey(name)]
  )
  return rows[0].id
}

// Walk a table in primary-key order (keyset pagination, so each batch is an
// index range scan) and hand each batch to `each`.
async function inBatches(client, table, keyColumn, keyType, columns, each) {
  let after = null
  for (;;) {
    const { rows } = await client.query(
      `SELECT ${keyColumn}, ${columns} FROM ${table}
        WHERE $1::${keyType} IS NULL OR ${keyColumn} > $1::${keyType}
        ORDER BY ${keyColumn} LIMIT ${BATCH}`,
      [after]
    )
    if (rows.length === 0) return
    await each(rows)
    after = rows[rows.length - 1][keyColumn]
  }
}

async function sealAuth(client) {
  const { rows: users } = await client.query(
    'SELECT id, email, phone, first_name, last_name, employee_no, employer FROM auth_users'
  )
  for (const u of users) {
    const ctx = (column) => aad('auth_users', column, u.id)
    await client.query(
      `UPDATE auth_users
          SET email_enc = $2, phone_enc = $3, first_name_enc = $4, last_name_enc = $5,
              employee_no_enc = $6, organisation_id = $7
        WHERE id = $1`,
      [
        u.id,
        seal(u.email, ctx('email')),
        seal(u.phone, ctx('phone')),
        seal(u.first_name, ctx('first_name')),
        seal(u.last_name, ctx('last_name')),
        seal(u.employee_no, ctx('employee_no')),
        u.employer?.trim() ? await upsertOrganisation(client, u.employer) : null,
      ]
    )
  }

  const { rows: otps } = await client.query(
    'SELECT id, channel, destination FROM auth_otp_codes WHERE destination IS NOT NULL'
  )
  for (const o of otps) {
    await client.query('UPDATE auth_otp_codes SET destination_masked = $2 WHERE id = $1', [
      o.id,
      maskDestination(o.channel, o.destination),
    ])
  }

  const { rows: sessions } = await client.query(
    'SELECT token_hash, user_agent FROM auth_sessions WHERE user_agent IS NOT NULL'
  )
  for (const s of sessions) {
    await client.query('UPDATE auth_sessions SET user_agent_enc = $2 WHERE token_hash = $1', [
      s.token_hash,
      seal(s.user_agent, aad('auth_sessions', 'user_agent', s.token_hash)),
    ])
  }
}

async function sealAnalyticsIdentity(client) {
  const { rows: members } = await client.query('SELECT id, external_ref, label FROM analytics_members')
  for (const m of members) {
    const ref = m.external_ref || `member:${m.id}`
    const refHash = blindIndex(ref, 'member')
    await client.query(
      `UPDATE analytics_members SET external_ref_hash = $2, external_ref_enc = $3, label_enc = $4 WHERE id = $1`,
      [
        m.id,
        refHash,
        seal(ref, aad('analytics_members', 'external_ref', refHash)),
        seal(m.label, aad('analytics_members', 'label', refHash)),
      ]
    )
  }

  const { rows: tokens } = await client.query(
    'SELECT token_hash, label FROM analytics_link_tokens WHERE label IS NOT NULL'
  )
  for (const t of tokens) {
    await client.query('UPDATE analytics_link_tokens SET label_enc = $2 WHERE token_hash = $1', [
      t.token_hash,
      seal(t.label, aad('analytics_link_tokens', 'label', t.token_hash)),
    ])
  }
}

async function sealDevicesAndSessions(client) {
  await inBatches(
    client,
    'analytics_devices',
    'id',
    'uuid',
    'user_agent, first_referrer, first_landing_path, first_utm',
    async (rows) => {
      const ctx = (column, id) => aad('analytics_devices', column, id)
      await client.query(
        `UPDATE analytics_devices d
            SET user_agent_enc = v.ua, first_referrer_enc = v.ref,
                first_landing_path_enc = v.landing, first_utm_enc = v.utm
           FROM unnest($1::uuid[], $2::bytea[], $3::bytea[], $4::bytea[], $5::bytea[])
                AS v(id, ua, ref, landing, utm)
          WHERE d.id = v.id`,
        [
          rows.map((r) => r.id),
          rows.map((r) => seal(r.user_agent, ctx('user_agent', r.id))),
          rows.map((r) => seal(r.first_referrer, ctx('first_referrer', r.id))),
          rows.map((r) => seal(r.first_landing_path, ctx('first_landing_path', r.id))),
          rows.map((r) => sealJson(r.first_utm, ctx('first_utm', r.id))),
        ]
      )
    }
  )

  await inBatches(
    client,
    'analytics_sessions',
    'id',
    'uuid',
    'entry_path, referrer, utm, user_agent',
    async (rows) => {
      const ctx = (column, id) => aad('analytics_sessions', column, id)
      await client.query(
        `UPDATE analytics_sessions s
            SET entry_path_enc = v.entry, referrer_enc = v.ref, utm_enc = v.utm, user_agent_enc = v.ua
           FROM unnest($1::uuid[], $2::bytea[], $3::bytea[], $4::bytea[], $5::bytea[])
                AS v(id, entry, ref, utm, ua)
          WHERE s.id = v.id`,
        [
          rows.map((r) => r.id),
          rows.map((r) => seal(r.entry_path, ctx('entry_path', r.id))),
          rows.map((r) => seal(r.referrer, ctx('referrer', r.id))),
          rows.map((r) => sealJson(r.utm, ctx('utm', r.id))),
          rows.map((r) => seal(r.user_agent, ctx('user_agent', r.id))),
        ]
      )
    }
  )
}

// Seed the rollups from the plaintext props — the last moment they are
// readable in SQL.
async function seedRollups(client) {
  await client.query(`
    INSERT INTO analytics_daily_counts (day, event_name, dims, count)
    SELECT (occurred_at AT TIME ZONE 'UTC')::date, name, '{}'::jsonb, count(*)
      FROM analytics_events
     GROUP BY 1, 2`)
  for (const [event, keys] of Object.entries(ROLLUP_DIMENSIONS)) {
    const dims = `jsonb_strip_nulls(jsonb_build_object(${keys
      .map((k) => `'${k}', left(NULLIF(props->>'${k}', ''), 120)`)
      .join(', ')}))`
    await client.query(
      `INSERT INTO analytics_daily_counts (day, event_name, dims, count)
       SELECT day, $1, dims, count(*) FROM (
         SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day, ${dims} AS dims
           FROM analytics_events WHERE name = $1
       ) t
       WHERE dims <> '{}'::jsonb
       GROUP BY day, dims`,
      [event]
    )
  }
}

async function sealEvents(client) {
  await inBatches(client, 'analytics_events', 'id', 'bigint', 'event_uid, path, props', async (rows) => {
    await client.query(
      `UPDATE analytics_events e
          SET path_enc = v.path, props_enc = v.props
         FROM unnest($1::bigint[], $2::bytea[], $3::bytea[]) AS v(id, path, props)
        WHERE e.id = v.id`,
      [
        rows.map((r) => r.id),
        rows.map((r) => seal(r.path, aad('analytics_events', 'path', r.event_uid))),
        rows.map((r) => sealJson(r.props ?? {}, aad('analytics_events', 'props', r.event_uid))),
      ]
    )
  })
}

export default {
  name: '003_popia_encryption',
  async run(client) {
    await client.query(ADD_STRUCTURE)
    await sealAuth(client)
    await sealAnalyticsIdentity(client)
    await sealDevicesAndSessions(client)
    await seedRollups(client)
    await sealEvents(client)
    await client.query(DROP_PLAINTEXT)
    await client.query(NEW_TABLES)
  },
  // Outside the transaction: rewrite the tables so the dropped plaintext
  // columns are physically nulled out of the heap.
  after: [
    'VACUUM FULL auth_users',
    'VACUUM FULL auth_otp_codes',
    'VACUUM FULL auth_sessions',
    'VACUUM FULL analytics_members',
    'VACUUM FULL analytics_link_tokens',
    'VACUUM FULL analytics_devices',
    'VACUUM FULL analytics_sessions',
    'VACUUM FULL analytics_events',
  ],
}
