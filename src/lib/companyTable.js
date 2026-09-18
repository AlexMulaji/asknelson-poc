// Pure helpers behind the admin "By company" table: how time in the app is
// written, and how the rows are narrowed and ordered. Kept out of the
// component so they can be tested without a DOM.

/** Seconds as a compact duration: "45s", "12m", "3h 05m", "2d 4h". */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  if (s < 60) return `${s}s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export const SORT_KEYS = {
  name: (row) => row.name?.toLowerCase() ?? '',
  events: (row) => Number(row.events) || 0,
  sessions: (row) => Number(row.sessions) || 0,
  members: (row) => Number(row.members) || 0,
  time_spent_seconds: (row) => Number(row.time_spent_seconds) || 0,
}

/**
 * Narrow and order company rows.
 *
 * @param {Array} rows
 * @param {object} options
 * @param {string} options.search         case-insensitive substring of the company name
 * @param {number|string} options.minEvents
 * @param {number|string} options.minUsers
 * @param {string} options.organisationId only this company, when the global company filter is set
 * @param {string} options.sortBy         a key of SORT_KEYS
 * @param {'asc'|'desc'} options.direction
 */
export function filterCompanies(rows, options = {}) {
  const {
    search = '',
    minEvents = 0,
    minUsers = 0,
    organisationId = '',
    sortBy = 'events',
    direction = 'desc',
  } = options
  const needle = search.trim().toLowerCase()
  const events = Number(minEvents) || 0
  const users = Number(minUsers) || 0
  const key = SORT_KEYS[sortBy] ?? SORT_KEYS.events
  const sign = direction === 'asc' ? 1 : -1

  return (rows ?? [])
    .filter((row) => !organisationId || row.id === organisationId)
    .filter((row) => !needle || row.name?.toLowerCase().includes(needle))
    .filter((row) => (Number(row.events) || 0) >= events)
    .filter((row) => (Number(row.members) || 0) >= users)
    .sort((a, b) => {
      const x = key(a)
      const y = key(b)
      if (x < y) return -sign
      if (x > y) return sign
      // Stable, readable tie-break: alphabetical.
      return (a.name ?? '').localeCompare(b.name ?? '')
    })
}
