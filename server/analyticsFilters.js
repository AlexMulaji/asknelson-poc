// Query-string -> SQL filter translation for the admin reporting endpoints.
//
// Kept apart from the routes for two reasons: the same filter has to apply
// identically to the overview, the session list and the CSV export (a company
// filter that silently doesn't reach the export is worse than no filter), and
// building SQL from user input is exactly the code that deserves tests it can
// be given a hostile query string without a database in the room.
//
// Every value either becomes a bound parameter or is rejected. Nothing from
// the request is ever concatenated into the SQL text.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// Event names are written by the app, not by people: letters, digits and
// underscores. Anything else is a probe, not a typo.
const EVENT_NAME_RE = /^[a-z0-9_]{1,64}$/i

export const MAX_WINDOW_DAYS = 365
export const DEFAULT_WINDOW_DAYS = 30

/** The reporting window in days, clamped so one request cannot scan everything. */
export function windowDays(value, fallback = DEFAULT_WINDOW_DAYS) {
  const days = Number(value)
  if (!Number.isFinite(days)) return fallback
  return Math.min(Math.max(Math.trunc(days), 1), MAX_WINDOW_DAYS)
}

/** A YYYY-MM-DD date, or null. Rejects anything that isn't a real calendar day. */
export function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  // Rejects 2026-02-31, which Date would roll forward into March.
  return parsed.toISOString().slice(0, 10) === value ? value : null
}

export function limitValue(value, { fallback = 50, max = 200 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), 1), max)
}

export function offsetValue(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(Math.trunc(n), 0) : 0
}

/**
 * Turn a request query into a WHERE fragment.
 *
 * @param {object} query        req.query
 * @param {object} options
 * @param {string} options.alias        table alias the columns live under
 * @param {string} options.timeColumn   the column the window applies to
 *                                      (occurred_at for events, started_at for sessions)
 * @param {number} options.startIndex   first $n to use, so a caller can place
 *                                      parameters of its own ahead of these
 * @param {boolean} options.allowName   whether name/category filters apply
 *
 * @returns {{where:string, params:Array, nextIndex:number, applied:object, errors:string[]}}
 *          `where` is either '' or 'WHERE …'; `errors` is non-empty when the
 *          caller should answer 400 rather than quietly ignore a bad filter.
 */
export function buildEventFilter(query = {}, options = {}) {
  const {
    alias = 'e',
    timeColumn = 'occurred_at',
    startIndex = 1,
    allowName = true,
    allowOrganisation = true,
  } = options

  const col = (name) => (alias ? `${alias}.${name}` : name)
  const clauses = []
  const params = []
  const applied = {}
  const errors = []
  let index = startIndex
  const bind = (value) => {
    params.push(value)
    return `$${index++}`
  }

  // An explicit from/to wins over the rolling window, so a report can be run
  // for "last month" rather than only "the last N days".
  const from = isoDate(query.from)
  const to = isoDate(query.to)
  if (query.from && !from) errors.push('from must be a YYYY-MM-DD date')
  if (query.to && !to) errors.push('to must be a YYYY-MM-DD date')

  if (from || to) {
    if (from) {
      clauses.push(`${col(timeColumn)} >= ${bind(`${from}T00:00:00Z`)}::timestamptz`)
      applied.from = from
    }
    if (to) {
      // Inclusive of the end day: people mean "up to and including the 30th".
      clauses.push(`${col(timeColumn)} < ${bind(`${to}T00:00:00Z`)}::timestamptz + interval '1 day'`)
      applied.to = to
    }
  } else {
    const days = windowDays(query.days)
    clauses.push(`${col(timeColumn)} > now() - ${bind(`${days} days`)}::interval`)
    applied.days = days
  }

  if (allowOrganisation && query.organisationId) {
    if (!UUID_RE.test(String(query.organisationId))) {
      errors.push('organisationId must be a UUID')
    } else {
      clauses.push(`${col('organisation_id')} = ${bind(String(query.organisationId))}::uuid`)
      applied.organisationId = String(query.organisationId)
    }
  }

  if (allowName && query.name) {
    // Several names comma-separated: "show me journey_started and completed".
    const names = String(query.name)
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    const bad = names.filter((n) => !EVENT_NAME_RE.test(n))
    if (bad.length) errors.push(`invalid event name: ${bad[0]}`)
    else if (names.length) {
      clauses.push(`${col('name')} = ANY(${bind(names)}::text[])`)
      applied.name = names
    }
  }

  if (allowName && query.category) {
    const category = String(query.category).trim()
    if (!EVENT_NAME_RE.test(category)) errors.push('invalid category')
    else {
      clauses.push(`${col('category')} = ${bind(category)}`)
      applied.category = category
    }
  }

  if (query.whatsappOnly === 'true') {
    clauses.push(`${col('is_whatsapp')} = true`)
    applied.whatsappOnly = true
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    nextIndex: index,
    applied,
    errors,
  }
}
