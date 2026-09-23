# Running AskNelson on the shared Odoo Postgres

This is how to move AskNelson off its bundled `db` container and into the
Postgres that the Odoo stack already runs. AskNelson gets its **own schema**
(`asknelson`) and its **own role** (`asknelson_app`) inside the Odoo database.
Odoo's `public` schema is never touched, and the app role can't read it.

The steps that need a superuser (creating the role and schema, moving existing
data) are done **by hand**, on purpose. The app role only ever needs to own its
own schema. It should never be able to create schemas or roles, or see Odoo's
tables. The app handles the rest itself:

| The app does, at every boot | Where |
| --------------------------- | ----- |
| Pins `search_path` to `DATABASE_SCHEMA` on every connection | `server/db.js`, `Pool` `options` |
| Waits up to `DATABASE_CONNECT_TIMEOUT_SECONDS` (60) for the database | `waitForDatabase()` |
| Refuses to start if the schema is missing, unusable or not writable | `assertSchema()` |
| Refuses to migrate a schema that has no history but already holds tables with AskNelson's names | collision guard in `migrate()` |
| Creates or upgrades its tables | `migrate()` |

Contents: [before you start](#before-you-start) ·
[1 role and schema](#1-create-the-role-and-schema) ·
[2 check isolation](#2-check-isolation) · [3 existing data](#3-existing-data-fresh-start-or-move) ·
[4 switch over](#4-switch-the-app-over) · [5 verify](#5-verify) ·
[rollback](#rollback) · [living next to Odoo](#living-next-to-odoo)

---

## Before you start

- **Docker Compose v2.24 or newer** (`docker compose version`). The overlay
  uses `!reset`.
- **The Odoo stack is running.** Note three names from `docker ps` and
  `docker network ls`. The examples below use the test host's values:

  | What | Example | Used as |
  | ---- | ------- | ------- |
  | Odoo's Postgres container | `kaelo19test-db-1` | `<odoo-db>` |
  | Odoo's database | `kaelo19` | `<db>` |
  | Odoo's compose network | `kaelo19test_default` | `SHARED_DB_NETWORK` |
  | A superuser on that Postgres (Odoo images usually use `odoo`) | `odoo` | `<su>` |

- **Postgres versions.** If you're moving data (step 3), the Odoo Postgres must
  be the **same major version or newer** than the bundled one (16). Check with
  `docker exec <odoo-db> postgres --version`.
- **Take a backup of the Odoo database first.** Nothing below modifies Odoo's
  objects, but you'll be working as a superuser on a production database.

Open a superuser shell on the Odoo database. Every SQL block below runs here
unless it says otherwise:

```sh
docker exec -it <odoo-db> psql -U <su> -d <db>
```

---

## 1. Create the role and schema

Pick a long random password (`openssl rand -base64 30`) and keep it for
`ASKNELSON_DATABASE_URL`.

```sql
CREATE ROLE asknelson_app LOGIN PASSWORD '<password>';
GRANT CONNECT ON DATABASE <db> TO asknelson_app;

-- Unqualified names from this role resolve to its own schema, including in a
-- plain psql session. The app pins this anyway; this covers humans.
ALTER ROLE asknelson_app IN DATABASE <db> SET search_path = asknelson;

-- Defensive. PG15+ already denies this by default, but Odoo databases created
-- on older versions may still grant CREATE on public to everyone.
REVOKE CREATE ON SCHEMA public FROM asknelson_app;
```

**Fresh start only** (you're *not* moving data in step 3): create the schema
now, owned by the app role:

```sql
CREATE SCHEMA asknelson AUTHORIZATION asknelson_app;
```

If you *are* moving data, **don't** create the schema here. The restore in
step 3 creates it, with the right owner.

Why the role must **own** the schema: migrations create and alter tables, and
migration 003 runs `VACUUM FULL`, which only a table's owner may do. Owning its
own schema is all it needs. It gets no rights on the database beyond `CONNECT`.

---

## 2. Check isolation

Connect as the app role (from any shell on the host):

```sh
docker exec -it <odoo-db> psql -U asknelson_app -d <db>
```

```sql
SELECT current_schema();          -- asknelson  (NULL until the schema exists)
SELECT count(*) FROM res_users;   -- ERROR: relation "res_users" does not exist
SELECT count(*) FROM public.res_users;  -- ERROR: permission denied
CREATE TABLE public.x ();         -- ERROR: permission denied for schema public
```

If any of the last three **succeed**, stop. The role can reach Odoo's data.
Check for grants to `PUBLIC` on Odoo's tables (`\dp public.*`) before going
further.

---

## 3. Existing data: fresh start or move

**Fresh start.** Nothing to do: the app builds its tables on first boot.
Anyone who signed up against the bundled database will have to sign up again.

**Moving existing accounts and progress.** The bundled database keeps its
tables in `public`. They need to end up in `asknelson` inside the Odoo
database, owned by `asknelson_app`. The procedure below is tested. It renames
the schema in a scratch copy, so neither the legacy database nor Odoo's
`public` is ever renamed.

Hard requirements:

- **The same `DATA_ENCRYPTION_KEYS` and `AUTH_PEPPER`** must be used after the
  move. Personal data is sealed with the keys, and logins are found by the
  pepper. With different values every sealed column is unreadable and nobody
  can sign in.
- **The same app version** on both sides, so the migration history matches
  the code.
- **The app stopped** during the move, so nothing is written to the old
  database afterwards.

```sh
# 0. Stop the app; make sure the legacy db is running.
docker compose stop asknelson
docker compose --profile legacy-db up -d db   # if the overlay is already active
LEGACY=$(docker compose ps -q db)             # the bundled db container

# 1. Dump the legacy database.
docker exec $LEGACY pg_dump -U asknelson -d asknelson -Fc -f /tmp/legacy.dump
docker cp $LEGACY:/tmp/legacy.dump ./legacy.dump
docker exec $LEGACY rm /tmp/legacy.dump
docker cp ./legacy.dump <odoo-db>:/tmp/legacy.dump

# 2. In a scratch database on the Odoo server, rename public -> asknelson and
#    dump just that schema. (Scratch, so nothing real is ever renamed.)
docker exec <odoo-db> createdb -U <su> asknelson_scratch
docker exec <odoo-db> pg_restore -U <su> -d asknelson_scratch --no-owner --no-privileges /tmp/legacy.dump
docker exec <odoo-db> psql -U <su> -d asknelson_scratch -c 'ALTER SCHEMA public RENAME TO asknelson;'
docker exec <odoo-db> pg_dump -U <su> -d asknelson_scratch -Fc --schema=asknelson \
  --no-owner --no-privileges -f /tmp/asknelson.dump

# 3. Restore into the Odoo database AS the app role, so it owns the schema and
#    every table. It needs CREATE on the database for exactly this one command.
docker exec <odoo-db> psql -U <su> -d <db> -c 'GRANT CREATE ON DATABASE <db> TO asknelson_app;'
docker exec <odoo-db> pg_restore -U <su> -d <db> --role=asknelson_app \
  --no-owner --no-privileges --exit-on-error /tmp/asknelson.dump
docker exec <odoo-db> psql -U <su> -d <db> -c 'REVOKE CREATE ON DATABASE <db> FROM asknelson_app;'

# 4. Clean up the scratch copy and the dump files: they hold personal data.
docker exec <odoo-db> dropdb -U <su> asknelson_scratch
docker exec <odoo-db> rm /tmp/legacy.dump /tmp/asknelson.dump
shred -u ./legacy.dump 2>/dev/null || rm ./legacy.dump
```

If `pg_restore` fails partway, drop the half-restored schema
(`DROP SCHEMA asknelson CASCADE;` — check first that it's the new one) and
repeat step 3. The `REVOKE` must run either way.

Check the result (superuser shell):

```sql
SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'asknelson';  -- asknelson_app
SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname = 'asknelson';        -- asknelson_app only
SELECT name FROM asknelson._analytics_migrations ORDER BY 1;  -- same list as the legacy db
SELECT count(*) FROM asknelson.auth_users;                    -- same as the legacy db
```

Compare the counts with the legacy database
(`docker exec $LEGACY psql -U asknelson -d asknelson -c 'SELECT count(*) FROM auth_users;'`).

---

## 4. Switch the app over

In `.env` on that host (see the shared-database block in `.env.example`):

```sh
COMPOSE_FILE=docker-compose.yml:docker-compose.shared-db.yml
SHARED_DB_NETWORK=kaelo19test_default
ASKNELSON_DATABASE_URL=postgres://asknelson_app:<password>@kaelo19test-db-1:5432/kaelo19
ASKNELSON_DATABASE_SCHEMA=asknelson
SHARED_DB_HOST=kaelo19test-db-1      # only for the optional dbproxy
```

Keep `DATA_ENCRYPTION_KEYS` and `AUTH_PEPPER` exactly as they were. Then:

```sh
docker compose up -d
docker compose logs -f asknelson
```

---

## 5. Verify

In the logs, expect one of:

- **Fresh start:** `applied migration 001_initial` … `006_…`, then
  `analytics + accounts enabled — schema up to date, encryption on`.
- **Moved data:** no `applied migration` lines, just the `schema up to date`
  line.

What the failure messages mean:

| Log says | Cause |
| -------- | ----- |
| `database not reachable yet (ENOTFOUND)`, repeating | Wrong container name in the URL, or `SHARED_DB_NETWORK` isn't Odoo's network |
| `password authentication failed` (no retries) | Wrong password in `ASKNELSON_DATABASE_URL` |
| `resolves to no schema` | Schema not created yet (step 1), or created under a different name |
| `cannot create tables in schema` | The schema exists but isn't owned by `asknelson_app`: `ALTER SCHEMA asknelson OWNER TO asknelson_app;` |
| `Refusing to migrate … already contains …` | The schema has tables AskNelson didn't create. Use an empty schema; don't delete someone else's tables |

Then check from the superuser shell that nothing landed next to Odoo:

```sql
\dt asknelson.*
SELECT tablename FROM pg_tables
 WHERE schemaname = 'public' AND tableowner = 'asknelson_app';   -- no rows
```

Sign in with an existing account (if you moved data) and open the admin
analytics tab.

**Local development against the shared DB**: `npm start` can't reach the
container network, so start the proxy
(`docker compose --profile tools up -d dbproxy`) and put `DATABASE_URL` (via
`127.0.0.1:5433`) and `DATABASE_SCHEMA=asknelson` in `.env`. The commented
lines in `.env.example` show both.

---

## Rollback

The bundled database and its volume are untouched by all of the above.

1. In `.env`, comment out `COMPOSE_FILE`, `ASKNELSON_DATABASE_URL` and
   `ASKNELSON_DATABASE_SCHEMA`.
2. `docker compose up -d` (brings `db` back without the overlay; with the
   overlay still in place, use `docker compose --profile legacy-db up -d db`).

Anything written to the shared database **after** the switch isn't in the
legacy one. Roll back early, or move the data back with step 3 reversed.

To remove AskNelson from the Odoo database entirely (superuser shell):

```sql
DROP SCHEMA asknelson CASCADE;   -- read the NOTICE list: only AskNelson tables
REVOKE CONNECT ON DATABASE <db> FROM asknelson_app;
ALTER ROLE asknelson_app IN DATABASE <db> RESET search_path;
DROP ROLE asknelson_app;
```

---

## Living next to Odoo

- **Odoo's backups now contain AskNelson's data.** The Odoo database manager
  (and any `pg_dump` of `<db>`) includes the `asknelson` schema. The personal
  data in it is sealed, but POPIA backup custody and retention
  (`docs/DATABASE.md` → POPIA) now apply to Odoo's backups too. Tell whoever
  runs them.
- **Restoring an Odoo backup restores AskNelson too**, to the time of that
  backup. Accounts and progress created since then are lost. Coordinate before
  restoring.
- **Odoo's "duplicate database" copies AskNelson** as well, including sealed
  personal data, into the copy. Drop the `asknelson` schema from duplicates
  used for testing.
- **Dropping the Odoo database drops AskNelson.**
- **Odoo module upgrades are safe.** They only touch `public`.
- **After a data move**, once you're confident, delete the legacy volume and
  any backups of it. As `docs/DATABASE.md` → Operations explains, old WAL and
  backups may hold data from before encryption:
  `docker compose --profile legacy-db down` then
  `docker volume rm <project>_asknelson-db`.
- **Connection limits.** AskNelson opens up to `DATABASE_POOL_MAX` (10)
  connections against Odoo's `max_connections`. Lower it if Odoo is short on
  connections.
