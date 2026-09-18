// Client for the admin API.
//
// There is no token to keep any more: sign-in sets an httpOnly cookie the
// browser sends on its own, so nothing about the session is reachable from
// JavaScript. The shared admin password that used to live in sessionStorage
// and ride along as a Bearer header is gone — see server/adminAuth.js.

/** Thrown for any non-2xx response, carrying what the UI needs to react. */
export class AdminApiError extends Error {
  constructor(message, { status, mfaRequired = false, required = null, body = null } = {}) {
    super(message)
    this.name = 'AdminApiError'
    this.status = status
    // The session has a password but no second factor yet — send them back to
    // the code screen rather than to a generic error.
    this.mfaRequired = mfaRequired
    // The permission the route wanted, when it was a 403.
    this.required = required
    this.body = body
  }
}

async function request(path, { method = 'GET', body, raw = false, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    // Same-origin cookies are sent by default, but being explicit means this
    // still works if the admin UI is ever served from a different origin.
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.ok) return res

  let payload = null
  try {
    payload = await res.json()
  } catch {
    /* an HTML error page or an empty body */
  }
  throw new AdminApiError(payload?.error || `Request failed (${res.status})`, {
    status: res.status,
    mfaRequired: Boolean(payload?.mfaRequired),
    required: payload?.required ?? null,
    body: payload,
  })
}

const json = async (...args) => (await request(...args)).json()

// --- sign in ------------------------------------------------------------------

/** @returns {{status:'mfa_required'|'enrolment_required', admin:object}} */
export const adminLogin = (email, password) =>
  json('/api/admin/auth/login', { method: 'POST', body: { email, password } })

export const startTotpEnrolment = () => json('/api/admin/auth/totp/setup', { method: 'POST' })

export const completeTotpEnrolment = (code) =>
  json('/api/admin/auth/totp/enrol', { method: 'POST', body: { code } })

/** Second factor: an authenticator code, or a recovery code. */
export const submitMfaCode = (code) =>
  json('/api/admin/auth/mfa', { method: 'POST', body: { code } })

/**
 * The code an authenticator app would be showing, for setting the portal up on
 * a machine without one. Only exists while the server has ADMIN_MFA_ECHO set —
 * it 404s otherwise, so callers must treat a failure as "not available".
 */
export const fetchMfaEcho = () => json('/api/admin/auth/totp/echo')

export const adminLogout = () => json('/api/admin/auth/logout', { method: 'POST' })

/** Who is signed in, and how far through sign-in they are. */
export const fetchAdminSession = () => json('/api/admin/auth/me')

export const changeOwnPassword = (currentPassword, newPassword) =>
  json('/api/admin/auth/password', { method: 'POST', body: { currentPassword, newPassword } })

export const regenerateRecoveryCodes = () =>
  json('/api/admin/auth/recovery-codes', { method: 'POST' })

// --- admin accounts -------------------------------------------------------------

export const fetchAdminUsers = () => json('/api/admin/users')

export const createAdminUser = (payload) =>
  json('/api/admin/users', { method: 'POST', body: payload })

export const updateAdminUser = (id, changes) =>
  json(`/api/admin/users/${id}`, { method: 'PATCH', body: changes })

export const resetAdminMfa = (id) =>
  json(`/api/admin/users/${id}/reset-mfa`, { method: 'POST' })

export const deleteAdminUser = (id) => json(`/api/admin/users/${id}`, { method: 'DELETE' })

// --- content --------------------------------------------------------------------

/** The editor wants drafts as well as live items; the app does not. */
export const fetchDataset = (key) => json(`/api/content/${key}?include=drafts`)

export const saveDataset = (key, data) => json(`/api/content/${key}`, { method: 'PUT', body: data })

/** Change one item's visibility without sending the whole dataset. */
export const setItemPublished = (key, ref, published) =>
  json(`/api/content/${key}/publish`, { method: 'POST', body: { ref, published } })

export const resetDataset = (key) => json(`/api/content/${key}/reset`, { method: 'POST' })

// --- media library ----------------------------------------------------------

export async function listUploads() {
  const body = await json('/api/admin/uploads')
  return { uploads: body.uploads ?? [], limits: body.limits ?? null }
}

/**
 * Posts the raw file bytes; the server sniffs the real format and ignores the
 * declared content type. Callers compress first (see lib/imageCompression.js)
 * — this only sends what it is given.
 */
export const uploadImage = (file) =>
  json(`/api/admin/uploads?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    raw: true,
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })

export const deleteUpload = (name) =>
  json(`/api/admin/uploads/${encodeURIComponent(name)}`, { method: 'DELETE' })

// --- analytics ---------------------------------------------------------------

/** Turn the panel's filter state into a query string, dropping empty values. */
export function analyticsQuery(filters = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === '' || value === false) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export const fetchOverview = (filters) =>
  json(`/api/analytics/admin/overview${analyticsQuery(filters)}`)

export const fetchOrganisations = (filters) =>
  json(`/api/analytics/admin/organisations${analyticsQuery(filters)}`)

export const fetchCompanyReport = (id, filters) =>
  json(`/api/analytics/admin/organisations/${id}${analyticsQuery(filters)}`)

export const fetchEventsByCompany = (filters) =>
  json(`/api/analytics/admin/by-company${analyticsQuery(filters)}`)

export const fetchSessions = (filters) =>
  json(`/api/analytics/admin/sessions${analyticsQuery(filters)}`)

export const fetchDevice = (id) => json(`/api/analytics/admin/devices/${id}`)

export const fetchLinkTokens = () => json('/api/analytics/admin/link-tokens')

export const createLinkToken = (payload) =>
  json('/api/analytics/admin/link-tokens', { method: 'POST', body: payload })

export const revokeLinkToken = (hash) =>
  json(`/api/analytics/admin/link-tokens/${hash}/revoke`, { method: 'POST' })

/**
 * Download the CSV export. Fetched rather than linked so a failure surfaces as
 * a message instead of a browser error page; the blob is then handed to the
 * browser as a normal download.
 */
export async function downloadEventsCsv(filters = {}) {
  const res = await request(`/api/analytics/admin/events.csv${analyticsQuery(filters)}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `asknelson-events-${filters.days ?? 'range'}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
