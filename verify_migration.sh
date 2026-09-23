#!/usr/bin/env bash
# Verify an asknelson-onto-Odoo Postgres migration:
#   1. Odoo's own tables are unchanged (fingerprint compare against a
#      restored pre-migration backup)
#   2. AskNelson's tables moved over completely and correctly (fingerprint
#      compare against the still-running legacy standalone container)
#   3. The migration didn't leave the shared instance in a bad state
#      (locks, connection headroom, recent errors)
#
# This does NOT touch production data — every check here is read-only.
#
# AUTH: this script talks to three different Postgres endpoints, almost
# certainly with three different passwords, so it relies on ~/.pgpass rather
# than a single PGPASSWORD env var. Create ~/.pgpass (chmod 0600) with one
# line per connection, format host:port:database:user:password, e.g.:
#
#   127.0.0.1:5433:kaelo19:asknelson_app:the-asknelson-app-password
#   127.0.0.1:5433:kaelo19:odoo:the-odoo-superuser-password
#   127.0.0.1:5434:kaelo19_pre_migration_scratch:postgres:whatever-you-set
#   127.0.0.1:5433:asknelson:asknelson:the-old-POSTGRES_PASSWORD
#
# psql matches the right line automatically per-connection; nothing else to
# configure. Fill in the variables below, then: bash verify_migration.sh

set -euo pipefail

# --- fill these in -----------------------------------------------------

# The live Odoo/shared Postgres, now also hosting the asknelson schema.
SHARED_HOST="127.0.0.1"
SHARED_PORT="5433"          # via the dbproxy profile, or wherever it's reachable
SHARED_DB="kaelo19"
SHARED_USER="asknelson_app"     # needs SELECT on the odoo schema(s) for step 1 only
ODOO_SUPERUSER=""           # a role that CAN read odoo's tables, for step 1 (leave SHARED_USER for step 2)

# A pre-migration backup of kaelo19, restored into a scratch database you can
# throw away afterwards. Do NOT run these fingerprint queries against
# production Odoo a second time under load -- restore the backup once.
SCRATCH_HOST="127.0.0.1"
SCRATCH_PORT="5434"
SCRATCH_DB="kaelo19_pre_migration_scratch"
SCRATCH_USER="postgres"

# The old standalone asknelson Postgres, still running via:
#   docker compose --profile legacy-db up -d db
LEGACY_HOST="127.0.0.1"
LEGACY_PORT="5433"          # whatever POSTGRES_HOST_PORT was on the old service
LEGACY_DB="asknelson"
LEGACY_USER="asknelson"

# Tables to fingerprint. Odoo tables: only ones NOT expected to change during
# a normal migration window (skip session/log/audit-style tables that churn
# on their own). AskNelson tables: all of them -- this data is static once
# the cutover happens.
ODOO_TABLES=("res_partner" "res_users")   # <-- replace with real, low-churn Odoo tables
ASKNELSON_TABLES=(
  analytics_members analytics_link_tokens analytics_devices
  analytics_sessions analytics_events auth_users auth_sessions
)

# --- helpers -------------------------------------------------------------

fingerprint() {
  local host=$1 port=$2 db=$3 user=$4 table=$5
  psql -h "$host" -p "$port" -U "$user" -d "$db" -tA -c \
    "SELECT md5(coalesce(string_agg(t::text, '' ORDER BY t.*::text), ''))
       FROM ${table} t;" 2>/dev/null || echo "ERROR"
}

rowcount() {
  local host=$1 port=$2 db=$3 user=$4 table=$5
  psql -h "$host" -p "$port" -U "$user" -d "$db" -tA -c \
    "SELECT count(*) FROM ${table};" 2>/dev/null || echo "ERROR"
}

echo "=== 1. Odoo tables: pre-migration backup vs live shared DB ==="
for t in "${ODOO_TABLES[@]}"; do
  before=$(fingerprint "$SCRATCH_HOST" "$SCRATCH_PORT" "$SCRATCH_DB" "$SCRATCH_USER" "$t")
  after=$(fingerprint "$SHARED_HOST" "$SHARED_PORT" "$SHARED_DB" "${ODOO_SUPERUSER:-$SHARED_USER}" "$t")
  if [ "$before" = "$after" ]; then
    echo "  OK    $t  (unchanged)"
  else
    echo "  DIFF  $t  before=$before after=$after   <- investigate: expected churn, or a real problem?"
  fi
done

echo
echo "=== 2. AskNelson tables: old standalone DB vs new schema in shared DB ==="
for t in "${ASKNELSON_TABLES[@]}"; do
  old_count=$(rowcount "$LEGACY_HOST" "$LEGACY_PORT" "$LEGACY_DB" "$LEGACY_USER" "$t")
  new_count=$(rowcount "$SHARED_HOST" "$SHARED_PORT" "$SHARED_DB" "$SHARED_USER" "asknelson.$t")
  old_fp=$(fingerprint "$LEGACY_HOST" "$LEGACY_PORT" "$LEGACY_DB" "$LEGACY_USER" "$t")
  new_fp=$(fingerprint "$SHARED_HOST" "$SHARED_PORT" "$SHARED_DB" "$SHARED_USER" "asknelson.$t")
  status="OK"
  [ "$old_count" != "$new_count" ] && status="COUNT MISMATCH"
  [ "$old_fp" != "$new_fp" ] && status="CONTENT MISMATCH"
  echo "  $status  $t  rows: old=$old_count new=$new_count"
done

echo
echo "=== 3. Shared instance health (locks, connections, headroom) ==="
psql -h "$SHARED_HOST" -p "$SHARED_PORT" -U "$SHARED_USER" -d "$SHARED_DB" <<'SQL'
\echo -- ungranted locks right now (should be empty)
SELECT * FROM pg_locks WHERE NOT granted;

\echo -- connection headroom
SELECT count(*) AS current_connections,
       current_setting('max_connections')::int AS max_connections
  FROM pg_stat_activity;

\echo -- idle-in-transaction sessions left over from anything (should be empty)
SELECT pid, state, query_start, state_change, query
  FROM pg_stat_activity
 WHERE state = 'idle in transaction';
SQL

echo
echo "Also check, outside this script:"
echo "  - Postgres server log for FATAL/ERROR around the migration window"
echo "  - Odoo's own application/error logs for the same window"
