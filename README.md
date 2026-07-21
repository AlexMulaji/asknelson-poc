# AskNelson

A mobile-first Progressive Web App for an Employee Assistance Programme (EAP):
a content and wellness portal. User progress (journeys, assessment history)
stays in the browser's `localStorage`; the content itself (Explore tiles,
journeys, assessments) is served by a small Express backend and can be edited
live from the **`/admin`** console.

Members reach the app via a personal WhatsApp link (`.../?t=<token>`) that
identifies them, backed by a SQLite database (`server/db.js`) that also
records click/page-view events per member.

## Stack

- Vite + React
- Tailwind CSS (custom components only — no UI library)
- PWA via `vite-plugin-pwa` (service worker + manifest, offline-capable)
- Routing via `react-router-dom`
- Express content API (`server/index.js`) — serves the build and editable JSON
- SQLite (`better-sqlite3`, `server/db.js`) — member identity, sessions, and
  event tracking, stored alongside the content JSON in the same data volume
- Docker (multi-stage build, named volume for content edits + the database)

## Getting started

### With Docker (recommended)

```bash
docker compose up --build
# App:   http://localhost:8180
# Admin: http://localhost:8180/admin
```

Set the admin password and the server secret via environment variables
(compose defaults both to insecure placeholders — change them before
deploying anywhere):

```bash
ADMIN_PASSWORD=my-secret SERVER_SECRET=some-long-random-value docker compose up --build
```

- `ADMIN_PASSWORD` protects `/admin`.
- `SERVER_SECRET` salts the one-way pseudonymous id used for sensitive
  (assessment) event tracking — see [Event tracking](#event-tracking).

Content edits made in `/admin` are written to the `asknelson-data` volume and
survive rebuilds, as does the SQLite database (`asknelson.db`, same volume)
holding members and events. Use **Reset to defaults** in the admin console to
restore the JSON shipped with the image.

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
- **Journeys** — programme details and every day's task, source link and
  reflection prompt.
- **Assessments** — card details, instructions and questions. Clinical logic
  (response scales, scoring bands, result copy, safety screens) is edited in
  the **Raw JSON** tab, available for all three datasets as a full-control
  escape hatch.
- **Members** — add a member to generate their personal WhatsApp link, copy
  it, and revoke access if needed. See [Member identity](#member-identity--whatsapp-links).
- **Events** — read-only counts of what members are clicking on, sourced
  straight from the events table. See [Event tracking](#event-tracking).

Saves go live immediately: the app fetches content from `/api/content/<key>`
(network-first, falling back to the bundled JSON when offline).

### Content API

| Method | Route                      | Auth   | Purpose                          |
| ------ | -------------------------- | ------ | -------------------------------- |
| GET    | `/api/content/:key`        | none   | Fetch a dataset (`explore`, `journeys`, `assessments`) |
| PUT    | `/api/content/:key`        | Bearer `ADMIN_PASSWORD` | Replace a dataset |
| POST   | `/api/content/:key/reset`  | Bearer `ADMIN_PASSWORD` | Restore the shipped JSON |
| POST   | `/api/admin/login`         | body `{ password }` | Validate the admin password |
| GET    | `/api/health`              | none   | Liveness check |
| POST   | `/api/auth/link`           | none   | Exchange a `?t=<token>` link for a session |
| GET    | `/api/auth/session`        | header `X-Session-Id` | Re-validate a stored session |
| POST   | `/api/events`              | none (attributed via `sessionId` in the body) | Record a tracking event |
| GET    | `/api/admin/members`       | Bearer `ADMIN_PASSWORD` | List members |
| POST   | `/api/admin/members`       | Bearer `ADMIN_PASSWORD` | Create a member + WhatsApp link |
| POST   | `/api/admin/members/:id/revoke` | Bearer `ADMIN_PASSWORD` | Revoke a member's access |
| GET    | `/api/admin/events/summary`| Bearer `ADMIN_PASSWORD` | Aggregate event counts |

## Member identity & WhatsApp links

Anyone opening the app needs a personal link — there's no anonymous access,
since this is confidential EAP content. In **`/admin` → Members**, add a
member (a name/label, optionally an employee id or phone number) to generate
a unique link: `https://<your-domain>/?t=<token>`. Send that link to them on
WhatsApp.

The first time it's opened, the app exchanges the token for a session id
(`POST /api/auth/link`) and stores it in `localStorage` — from then on the
device is recognised without needing the token again (works offline, like the
rest of the PWA). Revoking a member in the admin console blocks their next
sign-in attempt; anyone with no valid session and no token sees a full-screen
"open from your WhatsApp link" gate (`src/components/LinkGate.jsx`) instead of
the app.

This is identity for attribution and access, not a security perimeter — a
device that's already linked stays linked until you revoke it or the user
clears their browser storage.

## Event tracking

`src/services/EventTracker.js` posts a small event (`type`, `path`, a short
payload) to `/api/events` for page views and taps on Explore tiles, journey
days, meditation starts, the AskNelson SOS button/service links, and
assessment start/completion — see the call sites in `App.jsx`, `ContentCard.jsx`,
`ServiceCard.jsx`, `JourneyCard.jsx`, `DayCard.jsx`, `useMeditation.js`, and
`AssessmentFlow.jsx`. Calls use `navigator.sendBeacon` (falling back to
`fetch(..., { keepalive: true })`) and never throw — a dropped tracking call
never breaks navigation.

**Privacy split:** ordinary navigation/click events are stored against the
member directly (`server/db.js`), which is the point — seeing what members
are using. Assessment engagement (`assessment_started`, `assessment_completed`,
with which topic and resulting band) is wellbeing data, so it's stored
**pseudonymized**: under a one-way id derived from a per-member secret salt
and `SERVER_SECRET`, with `member_id` left `NULL`. It's never joined back to
a member's name anywhere — including in the admin **Events** tab, which only
ever shows assessment rows by their pseudonymous id.

## Pages

| Tab        | Route        | What it does                                         |
| ---------- | ------------ | ---------------------------------------------------- |
| Explore    | `/explore`   | Browse articles/videos, filter by theme chips        |
| Journeys   | `/journeys`  | Pick & follow a 30-day programme, progress in storage |
| Assessments| `/assessments` · `/assessments/:id` | Self-check screeners: intro → one question at a time → scored result |
| Meditate   | `/meditate`  | Timer (5/10/15/20 min) with optional ambient sound    |
| AskNelson  | `/asknelson` | SOS button + booking links to Kaelo Lifestyle         |

On desktop (≥1024px) the bottom tab bar becomes a left sidebar and content
widens into multi-column grids; mobile keeps the bottom nav + single column.

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
