// 004 — named admin accounts with two-factor auth and roles.
//
// Replaces the single shared ADMIN_PASSWORD. See server/rbac.js for what the
// roles mean and server/adminAuth.js for the sign-in flow.
//
// The text columns holding personal data are "protected" rather than the
// bytea+seal used elsewhere: the admin portal also runs in the no-database
// mode, where DATA_ENCRYPTION_KEYS may not exist, so one envelope format has
// to cover both (see protect/unprotect in server/crypto.js).

export default {
  name: '004_admin_rbac',
  sql: `
    CREATE TABLE admin_users (
      id                      uuid PRIMARY KEY,
      -- Sealed; found again through the keyed hash beside it.
      email_protected         text NOT NULL,
      email_hash              text NOT NULL UNIQUE,
      name_protected          text,

      -- Exactly one role per account. The permissions each role carries live
      -- in code (rbac.js), not here: they are reviewed in pull requests rather
      -- than edited in a database.
      role                    text NOT NULL,
      status                  text NOT NULL DEFAULT 'active',
      password_hash           text NOT NULL,

      -- The TOTP shared secret. Enrolled only once totp_enrolled_at is set;
      -- a secret with no enrolment date is an abandoned setup.
      totp_secret_protected   text,
      totp_enrolled_at        timestamptz,
      -- Highest TOTP step already accepted, which is what makes a code single
      -- use: without it a code stays valid for the rest of its 30s window.
      totp_last_counter       bigint,

      failed_logins           integer NOT NULL DEFAULT 0,
      locked_until            timestamptz,
      last_login_at           timestamptz,
      password_changed_at     timestamptz,
      created_at              timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT admin_users_role_chk
        CHECK (role IN ('analyst','editor','publisher','admin','owner')),
      CONSTRAINT admin_users_status_chk CHECK (status IN ('active','disabled'))
    );

    -- Admin sessions. mfa_verified false is a session that has passed the
    -- password and nothing else: it may enrol or present a second factor, and
    -- is refused everywhere else.
    CREATE TABLE admin_sessions (
      token_hash            text PRIMARY KEY,
      admin_id              uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      mfa_verified          boolean NOT NULL DEFAULT false,
      created_at            timestamptz NOT NULL DEFAULT now(),
      last_seen_at          timestamptz NOT NULL DEFAULT now(),
      expires_at            timestamptz NOT NULL,
      revoked_at            timestamptz,
      user_agent_protected  text
    );
    CREATE INDEX admin_sessions_admin_idx ON admin_sessions (admin_id);
    CREATE INDEX admin_sessions_expiry_idx ON admin_sessions (expires_at);

    -- Single-use codes for the lost-phone case. Only keyed hashes are stored,
    -- so the list shown at enrolment cannot be recovered from the database —
    -- it can only be replaced.
    CREATE TABLE admin_recovery_codes (
      id          uuid PRIMARY KEY,
      admin_id    uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
      code_hash   text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      used_at     timestamptz
    );
    CREATE UNIQUE INDEX admin_recovery_codes_hash_idx ON admin_recovery_codes (admin_id, code_hash);
  `,
}
