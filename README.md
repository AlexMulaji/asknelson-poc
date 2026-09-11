# AskNelson

A mobile-first Progressive Web App for an Employee Assistance Programme (EAP):
a content and wellness portal. User progress (journeys, assessment history)
lives in the browser's `localStorage` and, for signed-in members, is synced
to their account so they can continue on any device; the content itself (Explore tiles,
journeys, assessments) is served by a small Express backend and can be edited
live from the **`/admin`** console. Usage events are recorded in Postgres and
tied to the device — and, for members who arrive on a WhatsApp link, to the
person — see [Event tracking](#event-tracking).

## Stack

- Vite + React
- Tailwind CSS (custom components only — no UI library)
- PWA via `vite-plugin-pwa` (service worker + manifest, offline-capable)
- Routing via `react-router-dom`
- Express content API (`server/index.js`) — serves the build and editable JSON
- PostgreSQL event store (`server/db.js`, `server/analytics.js`) — optional
- Docker (multi-stage build, named volumes for content edits and the database)

## Getting started

### With Docker (recommended)

```bash
docker compose up --build
# App:   http://localhost:8180
# Admin: http://localhost:8180/admin
```

Compose starts two services: the app and a Postgres 16 database for event
tracking. The app waits for the database to pass its health check, runs its
migrations, and only then starts listening.

Set the admin password via the `ADMIN_PASSWORD` environment variable (compose
defaults to `change-me`):

```bash
ADMIN_PASSWORD=my-secret docker compose up --build
```

Content edits made in `/admin` are written to the `asknelson-data` volume and
survive rebuilds. Use **Reset to defaults** in the admin console to restore the
JSON shipped with the image.

### Without Docker

```bash
npm install
npm run dev      # frontend only, http://localhost:5173 (uses bundled JSON)
npm run serve    # content API + serves dist/ at http://localhost:8080
npm run start    # build + serve in one step
npm run build    # production build
npm run preview  # preview the production build
```

For local admin work run `npm run serve` in one terminal (API on :8080) and
`npm run dev` in another — vite proxies `/api` to :8080. Local edits are stored
in `data-store/` (gitignored).

## Admin console (`/admin`)

Password-gated editor (password = `ADMIN_PASSWORD`, default `admin` when unset)
for everything the member-facing app displays:

- **Explore** — themes and their article/video tiles: titles, descriptions,
  sources, URLs, colours, icons, read/watch times. Add, remove, reorder.
- **Journeys** — programme details, a **cover image**, an optional wide **hero
  image**, a **category** pill, and every day's task, source link and
  reflection prompt.
- **Assessments** — card details, instructions and questions. Clinical logic
  (response scales, scoring bands, result copy, safety screens) is edited in
  the **Raw JSON** tab, available for all three datasets as a full-control
  escape hatch.
- **Analytics** — read-only: usage totals, daily activity, most-opened content,
  recent sessions (click one for that device's full timeline), CSV export, and
  the WhatsApp link minting described under [Event tracking](#event-tracking).

Saves go live immediately: the app fetches content from `/api/content/<key>`
(network-first, falling back to the bundled JSON when offline).

### Images

Journeys carry `cover` (card thumbnail) and optional `cover_hero` (the wide
banner on the active journey); Explore tiles carry `image`; assessments carry
`cover` (the intro banner). All four use the same picker, which uploads a file,
browses previously uploaded images, or takes an external URL pasted by hand.
Uploads land in `<DATA_DIR>/uploads/` — the same persistent volume as the JSON
that references them — and are served publicly from `/uploads/<file>`.

- PNG, JPG, WEBP and GIF only, 8 MB max. The server identifies the format from
  the file's magic bytes, not its extension or `Content-Type`. SVG is rejected
  on purpose: it can carry script and these files are served same-origin.
- Filenames get a content-hash suffix (`anxiety-cover-acb20e4d.png`), so
  re-uploading identical bytes reuses the existing file and a replaced image is
  always a new URL — safe to cache immutably, in the browser and the service
  worker alike.
- A journey with no cover, or one whose image has been deleted from the
  library, falls back to the original colour-stripe card.

To offer an image on another field, add one line to its schema in
`src/components/admin/schemas.js` — the picker is generic:

```js
{ key: 'cover', label: 'Cover image', type: 'image' }
```

### Getting content edits back into the repo

Admin edits are written to `<DATA_DIR>/<key>.json`, which lives outside git. The
repo's `src/data/*.json` is **seed only** — the server never writes to it. So
content edited in `/admin` is invisible to git, doesn't travel between branches,
and is lost if the data volume is removed. Two ways to close that gap:

**Download JSON** (per dataset, in the admin toolbar) saves the dataset you're
looking at to your machine. Drop it into `src/data/` and commit. It exports
what's currently on screen, so it also rescues unsaved edits. A `*` on the
button means you're exporting unsaved changes.

**`npm run content:pull`** fetches all three datasets from a running instance
straight into `src/data/` — handy for lifting production content into a branch:

```bash
npm run content:pull                             # localhost:8080
npm run content:pull -- https://prod.example.com # any instance
git diff src/data                                # review, then commit
```

`GET /api/content/:key` is unauthenticated, so no admin password is needed.

> The pull **overwrites** the seed files. If the instance is running older
> content than your branch, that silently reverts work — so the script refuses
> to run when `src/data` has uncommitted changes. Commit or stash first, or pass
> `--force` if you really mean to discard them. To undo a bad pull:
> `git checkout -- src/data`.
>
> The first pull from a long-running instance will also reformat the files
> (the server round-trips JSON with a 2-space indent, losing the hand-written
> compact arrays). That's a one-off; later diffs are clean and content-only.

### Content API

| Method | Route                      | Auth   | Purpose                          |
| ------ | -------------------------- | ------ | -------------------------------- |
| GET    | `/api/content/:key`        | none   | Fetch a dataset (`explore`, `journeys`, `assessments`) |
| PUT    | `/api/content/:key`        | Bearer `ADMIN_PASSWORD` | Replace a dataset |
| POST   | `/api/content/:key/reset`  | Bearer `ADMIN_PASSWORD` | Restore the shipped JSON |
| POST   | `/api/admin/login`         | body `{ password }` | Validate the admin password |
| GET    | `/uploads/:file`           | none   | Serve an uploaded image |
| GET    | `/api/admin/uploads`       | Bearer `ADMIN_PASSWORD` | List the media library |
| POST   | `/api/admin/uploads?name=` | Bearer `ADMIN_PASSWORD` | Upload an image (raw body) |
| DELETE | `/api/admin/uploads/:file` | Bearer `ADMIN_PASSWORD` | Remove an image |
| GET    | `/api/health`              | none   | Liveness check |

## Event tracking

Every meaningful action in the app is recorded in Postgres, tied to the device
that produced it. The chain is **device → session → event**, with an optional
**member** hanging off the device.

### How a WhatsApp user gets identified

1. In **`/admin` → Analytics → WhatsApp links**, mint a link for a member. You
   supply *your* identifier for them (`EMP-10432`, a CRM id — whatever you use);
   you get back `https://your-app/?t=<opaque-token>`.
2. Send that link over WhatsApp.
3. When it opens, the app reads `?t=`, posts it to the server, and immediately
   rewrites the address bar so the token never appears in a screenshot, a
   forwarded link, or a `Referer` header.
4. The server hashes the token, finds the member, and binds the device to them.
   From then on **every event from that device carries the member id** — no
   login, and nothing to re-enter on a later visit.

Only the SHA-256 hash of a token is stored, so a leaked database cannot be used
to forge working links. The raw token is displayed exactly once, at mint time.

### Identity, in order of durability

| Id | Lives in | Survives |
| -- | -------- | -------- |
| `device_id` | `localStorage` + the `an_did` cookie | Either one being cleared — the server re-seeds the missing side |
| `session_id` | `localStorage`, 30-minute idle timeout | Reloads and tab switches within the window |
| `member_id` | Postgres, on the device row | Everything, once linked |

If a device is anonymous when it first arrives and a token shows up later, the
device's existing sessions and events are **backfilled** to that member, so a
visit that began before the link was recognised still counts.

### Events

Automatic: `session_start`, `session_end`, `page_view`, `app_installed`,
`connectivity_change`.

Explicit: `content_opened`, `theme_filtered`, `journey_started`,
`journey_switched`, `journey_day_completed`, `journey_completed`,
`journey_resource_opened`, `assessment_started`, `assessment_completed`,
`assessment_abandoned`, `meditation_started`, `meditation_completed`,
`meditation_stopped`, `sos_pressed`, `booking_clicked`.

Sign-in and sign-up: `registration_started`, `registration_step_completed`,
`registration_otp_sent`, `registration_otp_resent`,
`registration_verification_failed`, `registered`, `signed_in`,
`sign_in_failed`, `signed_out`, `password_reset_requested`,
`password_reset_completed`, `progress_restored`.

In-app viewer: `external_opened` (host, and whether it was embedded, played as
a video or blocked by the publisher), `external_closed` (seconds spent),
`external_opened_outside`. The full catalogue with props is in
[docs/DATABASE.md](docs/DATABASE.md#event-catalogue).

Add a new one with `track('name', { ...props })` from
`src/lib/analytics.js` — no server change is needed. Unknown names are accepted
and filed under the `custom` category.

> **Privacy.** `assessment_completed` carries the score, the band, and a
> `safety_triggered` boolean — the same rule the local history follows. Raw
> question responses are never sent anywhere, and the safety flag records only
> that a duty-of-care screen was shown. Don't put free text a member typed into
> event props.

### Behaviour

Tracking is best-effort and never blocks the UI. Events are queued in
`localStorage`, batched, and flushed every 5s, at 20 events, or on `pagehide`
via `sendBeacon`. Offline events are held (capped at 200) and sent on
reconnect; failures back off exponentially to a minute. Each event carries a
client-generated `event_uid` and ingest is `ON CONFLICT DO NOTHING`, so a
retried batch cannot duplicate rows. The `/admin` console is staff-facing and is
deliberately not tracked.

Sessions are closed by a `session_end` event, or by a sweeper that runs every
10 minutes and closes anything idle for 30, so an abandoned tab doesn't stay
open forever.

### Configuration

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `DATABASE_URL` | *(unset)* | Postgres connection string. **Unset disables tracking entirely** — the endpoints return 204 and the app is unchanged. |
| `DATA_ENCRYPTION_KEYS` | *(unset)* | **Required with a database.** AES-256-GCM key(s) sealing personal information at rest, `<id>:<base64>`, newest first. `npm run keys:generate` prints one. The server won't start without it. |
| `DATABASE_SSL` | *(auto)* | `verify-full` in production (TLS + certificate check, CA from `DATABASE_SSL_CA_FILE`); `require` encrypts without verifying; `disable` only for the compose network. |
| `ANALYTICS_RETENTION_DAYS` | `730` | Raw events, sessions and idle devices older than this are deleted daily. De-identified daily counts are kept. `0` keeps forever. |
| `AUDIT_RETENTION_DAYS` | `1825` | Audit-log retention. |
| `FORCE_HTTPS` | `false` | Redirect HTTP to HTTPS (set once TLS terminates in front of the app). |
| `DATABASE_POOL_MAX` | `10` | Connection pool size. |
| `PUBLIC_BASE_URL` | request host | Base for the minted WhatsApp links. |
| `TRUST_PROXY_HOPS` | `1` | Proxy hops to trust for client IP and HTTPS detection. |

A configured-but-unreachable database is fatal at boot: failing loudly beats
silently dropping every event.

### Analytics API

All admin routes take `Authorization: Bearer <ADMIN_PASSWORD>`.

| Method | Route | Auth | Purpose |
| ------ | ----- | ---- | ------- |
| POST | `/api/analytics/session` | none | Open/resume a session; redeems the `?t=` token |
| POST | `/api/analytics/events` | none | Ingest a batch of events |
| GET | `/api/analytics/admin/overview?days=` | admin | Totals, per-event counts, daily series, top content |
| GET | `/api/analytics/admin/sessions?limit=&offset=` | admin | Recent sessions |
| GET | `/api/analytics/admin/devices/:id` | admin | One device: profile, sessions, event timeline |
| GET | `/api/analytics/admin/events.csv?days=` | admin | CSV export |
| POST | `/api/analytics/admin/link-tokens` | admin | Mint a WhatsApp link |
| GET | `/api/analytics/admin/link-tokens` | admin | List links and their usage |
| POST | `/api/analytics/admin/link-tokens/:hash/revoke` | admin | Revoke a link |

### Schema

The full design — every table, the ERD, what is encrypted and why, and the
POPIA mapping — is in **[docs/DATABASE.md](docs/DATABASE.md)**; the DDL is in
[docs/schema.sql](docs/schema.sql).

| Table | One row per |
| ----- | ----------- |
| `analytics_members` | A person, keyed by a hash of *your* `external_ref` |
| `analytics_link_tokens` | A minted WhatsApp link (hash only) |
| `analytics_devices` | A browser profile, linked to a member once a token is used |
| `analytics_sessions` | A visit |
| `analytics_events` | A single tracked action |
| `analytics_daily_counts` | De-identified count per day, event and dimension — no ids |

Event names, ids and timestamps are stored in the clear so reporting can count
them; props, paths, referrers, user agents and member refs are sealed with
AES-256-GCM (`server/crypto.js`) and decrypted only by the admin API.

Migrations live in `server/db.js` (and `server/migrations/`) and run
automatically at boot, tracked in `_analytics_migrations`. **Never edit a
shipped migration** — add a new entry to the `MIGRATIONS` array, or existing
databases will drift from new ones.

`device_id` and `member_id` are denormalised onto every event row, so the common
"everything this person did" query needs no join through sessions.

### Reading the data

Three ways in, easiest first.

**1. The admin console.** `/admin` → **Analytics**: totals, daily activity,
most-opened content, and recent sessions — click any row for that device's full
event timeline. **Export CSV** pulls the raw events for the selected window.

**2. `psql` in the container.** No credentials to look up:

```bash
docker compose exec db psql -U asknelson -d asknelson
```

**3. A GUI client** (DBeaver, TablePlus, pgAdmin) on `localhost:5433`:

| Field | Value |
| ----- | ----- |
| Host / Port | `127.0.0.1` / `5433` (override with `POSTGRES_HOST_PORT`) |
| Database / User | `asknelson` / `asknelson` |
| Password | `POSTGRES_PASSWORD`, default `asknelson` |

The port is bound to `127.0.0.1`, so the database is reachable from this machine
only and never from the network. Remove the `ports:` block from the `db` service
to close it entirely.

#### Useful queries

Personal columns are `bytea` ciphertext in `psql` — read them through the admin
console or its CSV export, which decrypt (and audit the access). Counts and
timelines need no key:

```sql
-- The raw stream, newest first (props are sealed; names and times are not).
SELECT e.occurred_at, e.name, e.category, e.member_id IS NOT NULL AS identified
  FROM analytics_events e
 ORDER BY e.occurred_at DESC
 LIMIT 100;

-- One session, in order — what a single visit actually looked like.
SELECT e.client_seq, e.name, e.occurred_at
  FROM analytics_events e
 WHERE e.session_id = '<session-uuid>'
 ORDER BY e.client_seq;

-- Most-opened content, from the de-identified daily counts.
SELECT dims->>'title' AS title, sum(count) AS opens
  FROM analytics_daily_counts
 WHERE event_name = 'content_opened' AND dims ? 'title'
 GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

-- SOS presses per day.
SELECT day, count FROM analytics_daily_counts
 WHERE event_name = 'sos_pressed' AND dims = '{}'
 ORDER BY day DESC;

-- Which links have been opened, and which are still sitting unused.
SELECT t.created_at, t.first_used_at, t.use_count
  FROM analytics_link_tokens t
 WHERE t.revoked_at IS NULL
 ORDER BY t.created_at DESC;
```

## Accounts, OTP and anonymity

An account is **optional**: a WhatsApp tap lands straight in the content and
every feature works signed-out. Sign-in is a quiet control in the header (and
the desktop sidebar), never a wall.

### The registration flow (Figma)

```
Create Account: mobile, email (optional), SA ID number, company
  → Password + confirmation + privacy consent
  → Verify Account: 6-digit code sent by SMS to the mobile number
  → signed in, pre-sign-up progress saved to the account → /home
```

Nothing is written until the password step: the account and its first code are
created in one call, so an abandoned sign-up leaves no half-built row. Pending
registrations older than 24 hours are deleted by a sweeper, because they still
hold contact details. Any 13-digit ID number is accepted for now
(`AUTH_STRICT_SA_ID=true` also checks the date and check digit), and only a
keyed hash of it is kept, for duplicate detection.

Sign in (`/login`) takes the mobile number (email also works) and honours
**Remember Me**: ticked is a 30-day rolling session; unticked is a
browser-session cookie capped at 12 hours. Members land where they left off.
**Forgot Password** (`/forgot` → `/reset?token=…`) sends a single-use,
30-minute link by SMS or email; using it signs the account out everywhere.

### The two account kinds

The Figma flow creates **identified** accounts. The API still supports
**anonymous** ones (`anonymous: true`), which no screen currently offers.

|  | Anonymous | Identified |
| -- | --------- | ---------- |
| Stored | Username, password | Mobile, email, company — encrypted |
| ID number | — | Keyed hash only, never the number |
| Contact details | **Erased at verification**, hash kept for login | Retained, encrypted |
| Analytics member | **Never linked** | Linked; past events backfilled |
| Signs in with | Username, or the erased email/phone via its hash | Mobile, email or username |

The anonymous promise — *"even we can't link your activity back to you"* — is
enforced by a database `CHECK` constraint, not by application code:

```sql
CONSTRAINT auth_users_anon_unlinked_chk CHECK (
  NOT is_anonymous OR (
    member_id IS NULL AND first_name_enc IS NULL AND last_name_enc IS NULL
    AND id_number_hash IS NULL
  )
)
```

An anonymous row physically cannot carry a member link, so a future code change
cannot quietly break the promise. Their events stay unattributed in
`analytics_events`.

Neat consequence of the peppered hashes: someone who registered anonymously can
still sign in with the email address they verified, even though the service no
longer holds it.

### Security

- **Passwords** — scrypt (`N=32768, r=8, p=1`) from `node:crypto`. Chosen over
  argon2/bcrypt because both are native addons that complicate the Alpine build
  for no gain here.
- **Sessions** — random 32-byte token in an `httpOnly`, `SameSite=Lax` cookie;
  only its SHA-256 hash is stored, so a stolen database cannot mint a valid
  cookie. Rolling 30-day expiry.
- **PINs** — 6 digits from `crypto.randomInt`, stored hashed, 10-minute expiry,
  5 attempts, single use, superseded on resend.
- **Lockout** — 8 failed logins locks an account for 15 minutes. Login failures
  return an identical message whether or not the account exists, and a missing
  account still burns hashing time so it cannot be detected by timing.
- **Rate limits** — per IP on registration, login and OTP endpoints; reset
  links also per destination number, so the form can't flood one phone.
- **Encryption at rest** — contact details, names, progress and event details
  are sealed with AES-256-GCM before they reach Postgres, bound to their row
  so a copied ciphertext won't decrypt elsewhere. See
  [docs/DATABASE.md](docs/DATABASE.md#encryption-at-rest).
- **Encryption in transit** — `DATABASE_SSL=verify-full`, HSTS, optional
  `FORCE_HTTPS`, `Secure` cookies, `no-store` on personal responses.
- **No account enumeration on reset** — Forgot Password answers the same way
  whether or not the number is registered (the design's "Account not found"
  state needs `AUTH_REVEAL_UNKNOWN_ACCOUNTS=true`).
- **Audit log** — sign-ins, resets, exports, deletions and admin access to
  personal data, with hashed IPs.

### OTP delivery

`server/otp.js` is a transport interface. Swapping providers is an env change:

| `OTP_TRANSPORT` | Behaviour |
| --------------- | --------- |
| `console` (default) | Logs the PIN server-side. No provider needed. |
| `twilio` | SMS. Needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`. |
| `sendgrid` | Email. Needs `SENDGRID_API_KEY`, `SENDGRID_FROM`. |
| `webhook` | POSTs `{channel, to, code, message}` to `OTP_WEBHOOK_URL` — for Clickatell, an in-house gateway, or a WhatsApp Business sender. |

### Demo mode — testing sign-up without a provider

`OTP_ECHO=true` returns the PIN in the API response and shows it on the
verification screen, so the whole flow can be exercised with no SMS or email
provider. **Docker Compose defaults it on.** Tap the displayed code to fill it in.

The PIN is still real — random, single-use, 10-minute expiry, and a wrong code
is still rejected. Only its *delivery* is shortcut. It is not a bypass and not a
fixed backdoor code.

It is deliberately **not** tied to `NODE_ENV`: the production image bakes
`NODE_ENV=production` in, which would block demo mode on a laptop for no good
reason. Instead it takes one unambiguous opt-in and announces itself three ways
— a boxed banner at boot, `"demo": true` on every response, and an amber panel
on the screen.

> **With demo mode on, anyone can verify an email address or phone number they
> don't own.** Set `OTP_ECHO=false` before real users can reach the app:
>
> ```bash
> OTP_ECHO=false docker compose up -d
> ```

### Auth configuration

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AUTH_PEPPER` | *(unset)* | **Set this.** Keys the email/phone/ID hashes; without it they are brute-forceable, since the space of phone numbers is tiny. Rotating it invalidates every anonymous login, so treat it as permanent. |
| `AUTH_SESSION_DAYS` | `30` | Session lifetime with Remember Me. |
| `AUTH_SHORT_SESSION_HOURS` | `12` | Session lifetime without Remember Me. |
| `PRIVACY_NOTICE_VERSION` | `2026-09` | Recorded with each consent; bump when the notice changes. |
| `AUTH_REVEAL_UNKNOWN_ACCOUNTS` | `false` | Show the design's "Account not found" on Forgot Password (reveals whether a number is registered). |
| `AUTH_STRICT_SA_ID` | `false` | Only accept real SA ID numbers (valid date + check digit). Off: any 13 digits. |
| `SMS_TRANSPORT` / `EMAIL_TRANSPORT` | `OTP_TRANSPORT` | Per-channel provider — reset links can go by SMS or email. |
| `OTP_TRANSPORT` | `console` | See above. |
| `OTP_ECHO` | `false` (compose sets `true`) | Demo mode — shows the PIN on screen. Turn off before real users. |

### Auth API

| Method | Route | Purpose |
| ------ | ----- | ------- |
| POST | `/api/auth/register/start` | Create a pending account, send the first PIN |
| POST | `/api/auth/register/resend` | Reissue a PIN |
| POST | `/api/auth/register/verify` | Verify, activate, sign in |
| POST | `/api/auth/login` | Sign in with mobile, email or username (`remember`) |
| POST | `/api/auth/logout` | Revoke the session |
| GET | `/api/auth/me` | Current user, or `{ user: null }` |
| GET | `/api/auth/username-available` | Live username check |
| POST | `/api/auth/password/forgot` | Send a reset link by SMS or email |
| GET | `/api/auth/password/reset/validate` | Is this reset link still usable? |
| POST | `/api/auth/password/reset` | Set a new password from a reset link |
| GET | `/api/auth/me/export` | POPIA access request: all data held, decrypted |
| POST | `/api/auth/me/delete` | POPIA deletion: account, progress, analytics (needs password) |

Progress endpoints (`/api/progress/*`) are listed in
[docs/DATABASE.md](docs/DATABASE.md#progress-continue-where-you-left-off).

### Not built yet

Screens for the POPIA export and delete endpoints, and a profile page to
correct details — none are in the Figma designs yet.

## External links in-app

Articles, videos and the Kaelo booking form open in an in-app viewer
(`src/components/InAppBrowser.jsx`) instead of leaving the app. YouTube and TED
videos play through their embed players. Other pages are framed only if the
publisher allows it — about half of the linked sites refuse (X-Frame-Options /
CSP), and the viewer then offers "Open in browser". `GET /api/embed/check`
decides, and only for hosts the content links to. Details and the host survey:
[docs/DATABASE.md](docs/DATABASE.md#external-content-in-app).

## Pages

| Tab        | Route        | What it does                                         |
| ---------- | ------------ | ---------------------------------------------------- |
| Sign in    | `/login`     | Mobile number + password, Remember Me                |
| Register   | `/register`  | Details → password + consent → SMS code (Figma flow) |
| Forgot     | `/forgot`    | Reset link by SMS or email                           |
| Reset      | `/reset`     | New password from the reset link                     |
| Home        | `/home`        | Greeting hero, "Continue Your Journey", quick actions |
| My Wellness | `/my-wellness` | Journey programmes and meditation, behind a segmented control (`?tab=meditation`) |
| Explore    | `/explore`   | Search, topic chips, articles/videos        |
| Journeys   | `/journeys`  | Pick & follow a 30-day programme, progress in storage |
| Assessments| `/assessments` · `/assessments/:id` | Self-check screeners: intro → one question at a time → scored result |
| Meditate   | `/meditate`  | Timer (5/10/15/20 min) with optional ambient sound    |
| AskNelson  | `/asknelson` | Booking cards + "Get Help Now"          |

On desktop (≥1024px) the bottom tab bar becomes a left sidebar and content
widens into multi-column grids; mobile keeps the bottom nav + single column.
Taking an assessment (`/assessments/:id`) drops the nav entirely — it's a
full-screen task in the V1 design.

### Route changes in V1

The V1 design merges the old Journeys and Meditate tabs into **My Wellness** and
adds **Home**. The previous routes still work and redirect, query string intact:

| Old | Now |
| --- | --- |
| `/journeys`, `/journeys?journey=grief` | `/my-wellness`, `/my-wellness?journey=grief` |
| `/meditate` | `/my-wellness?tab=meditation` |
| `/` | `/home` |

## Design tokens

Sampled directly from the V1 Figma mockups and defined in `tailwind.config.js`:

| Token | Hex | Used for |
| ----- | --- | -------- |
| `brand` | `#89BA16` | Primary CTAs, active nav, accents |
| `brand-tint` / `brand-wash` | `#EDF4DC` / `#F9FBF4` | Icon chips, active nav pill, active day card |
| `navy` | `#01243B` | Headings, dark hero cards, active filter chip |
| `accent` | `#FF751C` | Assessments (default; each carries its own `color`) |
| `danger` | `#E1231F` | "Get Help Now" and the safety gate only |
| `muted` / `line` / `canvas` | `#93A1AA` / `#E6EBED` / `#F4F6F7` | Inactive labels, hairlines, page background |

Category and activity pills (`src/components/Pill.jsx`) map a label such as
"Anxiety & Stress" or "Reflect" onto a fixed tint, so a topic reads the same
colour everywhere.

**Typeface:** the mockup PDFs ship their text as outlines, so the brand family
name isn't recoverable from them. **Nunito** stands in as the closest available
match. To swap it, change the Google Fonts link in `index.html` and
`fontFamily` in `tailwind.config.js`.

## Imagery

Seed photography lives in `public/media/` and is referenced from the content
JSON by path (`/media/journey-anxiety.jpg`). It was extracted from the Figma
source file and resized to 1400px wide. Anything uploaded through `/admin`
lands in `<DATA_DIR>/uploads/` instead — see **Images** below. Both are cached
by the service worker for offline use.

## Data files

Both live in `src/data/`. The components read these exact shapes.

### `explore.json`

Themes wrap their own content; each theme becomes a filter chip and supplies the
accent colour for its cards.

```json
{
  "explore": {
    "themes": [
      {
        "id": "anxiety",
        "title": "Anxiety & Stress",
        "description": "Understand and manage anxiety in everyday life.",
        "color": "#7F77DD",
        "bg": "#EEEDFE",
        "icon": "ti-heart-rate-monitor",
        "content": [
          {
            "id": "ax-01",
            "type": "article",
            "title": "What is anxiety and why do we feel it?",
            "description": "A plain-language guide…",
            "source": "Mind UK",
            "url": "https://example.com/article",
            "read_time_mins": 8
          },
          {
            "id": "ax-02",
            "type": "video",
            "title": "How anxiety affects your body",
            "description": "A short animated explainer…",
            "source": "TED-Ed",
            "url": "https://example.com/video",
            "duration_mins": 5
          }
        ]
      }
    ]
  }
}
```

- `type` is `"article"` or `"video"` (lowercase).
- Articles use `read_time_mins`; videos use `duration_mins`. The UI renders
  these as `"8 min read"` / `"5 min"`.

### `journeys.json`

```json
{
  "journeys": [
    {
      "id": "anxiety",
      "title": "Understanding Your Anxiety",
      "description": "A 30-day guided journey…",
      "duration_days": 30,
      "color": "#7F77DD",
      "icon": "ti-heart-rate-monitor",
      "days": [
        {
          "day": 1,
          "type": "read",
          "title": "What is anxiety, really?",
          "task": "Read this plain-language explainer…",
          "source_title": "What is anxiety? — Mind UK",
          "source_url": "https://example.com",
          "reflection": "After reading, write down one situation…"
        }
      ]
    }
  ]
}
```

- `type` is `"read"`, `"watch"`, `"reflect"`, or `"practice"` (lowercase).
- `source_title` / `source_url` are optional per day (`null` when absent);
  `reflection` is an optional prompt shown on the current-day card.
- Progress is stored at `asknelson.journey.<id>` as
  `{ startDate, completedDays: [] }`, with the active journey id at
  `asknelson.activeJourney`.

### `assessments.json`

Each assessment is fully self-describing — content, scoring, bands, and CTAs all
live in JSON so they can be edited without touching code.

```json
{
  "assessments": [
    {
      "id": "anxiety",
      "title": "Anxiety Check",
      "subtitle": "A quick, validated screen for anxiety symptoms.",
      "description": "…",
      "color": "#7F77DD",
      "bg": "#EEEDFE",
      "icon": "ti-heart-rate-monitor",
      "time_mins": 2,
      "retake_after_days": 14,
      "disclaimer": "This is a self-check, not a diagnosis.",
      "instructions": "Over the last 2 weeks…",
      "response_scale": [{ "label": "Not at all", "value": 0 }],
      "questions": [{ "id": "q1", "text": "…" }],
      "scoring": { "type": "sum", "min": 0, "max": 21 },
      "results": [
        {
          "band": "Minimal anxiety",
          "min": 0,
          "max": 4,
          "headline": "…",
          "body": "…",
          "cta": { "type": "explore", "target": "mindfulness", "label": "…" }
        }
      ]
    }
  ]
}
```

Scoring rules (implemented in `src/lib/assessmentScoring.js`):

- **Score = sum of selected option values.** Options come from the assessment's
  `response_scale`, except where a question has its own `options` array (the
  Sleep assessment), which take precedence.
- **`"reverse": true`** on a question scores it as `scale_max - response` (using
  `scoring.scale_max`), so higher always means "more of the measured thing".
- **`"type": "sum_with_dimensions"`** (Burnout) also computes each dimension's
  subtotal; if a dimension reaches its `high_threshold`, the matching
  `dimension_flags` note is shown on the result — even when the overall band is
  lower.
- The final score is matched to the `results[]` band whose `min`/`max` range it
  falls in.
- **CTAs** route by `cta.type`: `journey` opens that journey by `target` id,
  `explore` opens that Explore theme by `target` id (`/explore?theme=…`),
  `asknelson` opens the AskNelson tab.

**Safety gate (critical).** If an assessment has a `safety` object (the Mood /
PHQ-9 check), and its `trigger_question` is answered above the `trigger_when`
threshold (e.g. `q9 > 0`), the result screen shows the `safety` headline/body/CTA
**first and instead of** the normal band — regardless of total score. This is a
hard, non-skippable gate.

History is stored at `asknelson.assessment.<id>` as
`{ lastScore, lastBand, lastDate, history: [{ date, score, band }] }`. **Only the
score, band, and date are persisted — never the raw answers.** `retake_after_days`
drives the "ready to retake" hint on each card. All result copy is screening
language; nothing states the user "has" a condition.

## Meditation audio

Add files to `src/assets/sounds/`: `rain.mp3`, `forest.mp3`, `ocean.mp3`,
`bowls.mp3`. They're picked up automatically. See that folder's README.

## Notifications

`src/services/NotificationService.js` is a scaffold. On first load (after 5s)
the app asks for notification permission and stores the choice in
`localStorage`. `scheduleNotification(title, body, delayMs)` currently uses a
local `setTimeout` fallback — the real scheduling is left as a `TODO` for a
future OneSignal integration.

## Icons

`public/icons/*.png` are solid-navy placeholders generated by
`scripts/gen-icons.mjs`. Replace them (and `public/favicon.svg`) with real brand
assets, then regenerate or overwrite as needed.

## Brand

Placeholder colours live in `tailwind.config.js`:

- Primary navy `#172B5C` (`brand`)
- Primary green `#4CB03F` (`brand-green`)

Replace with real hex values when brand assets arrive.
