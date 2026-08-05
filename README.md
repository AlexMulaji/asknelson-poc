# AskNelson

A mobile-first Progressive Web App for an Employee Assistance Programme (EAP):
a content and wellness portal. User progress (journeys, assessment history)
stays in the browser's `localStorage`; the content itself (Explore tiles,
journeys, assessments) is served by a small Express backend and can be edited
live from the **`/admin`** console.

## Stack

- Vite + React
- Tailwind CSS (custom components only — no UI library)
- PWA via `vite-plugin-pwa` (service worker + manifest, offline-capable)
- Routing via `react-router-dom`
- Express content API (`server/index.js`) — serves the build and editable JSON
- Docker (multi-stage build, named volume for content edits)

## Getting started

### With Docker (recommended)

```bash
docker compose up --build
# App:   http://localhost:8180
# Admin: http://localhost:8180/admin
```

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

## Pages

| Tab         | Route          | What it does                                        |
| ----------- | -------------- | --------------------------------------------------- |
| Home        | `/home`        | Greeting hero, "Continue Your Journey", quick actions |
| My Wellness | `/my-wellness` | Journey programmes and meditation, behind a segmented control (`?tab=meditation`) |
| Assessments | `/assessments` · `/assessments/:id` | Self-check screeners: intro → one question at a time → scored result |
| Explore     | `/explore`     | Search, topic chips, articles/videos                 |
| AskNelson   | `/asknelson`   | Booking cards + "Get Help Now"                       |

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
