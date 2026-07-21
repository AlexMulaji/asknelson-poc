// Thin client for member identity — exchanging a WhatsApp link token for a
// session and remembering it on the device. Mirrors the adminApi.js pattern.

const SESSION_KEY = 'asknelson.session_id'
const LABEL_KEY = 'asknelson.member_label'

export function getSessionId() {
  try {
    return localStorage.getItem(SESSION_KEY) || ''
  } catch {
    return ''
  }
}

export function getMemberLabel() {
  try {
    return localStorage.getItem(LABEL_KEY) || ''
  } catch {
    return ''
  }
}

function setSession(sessionId, label) {
  try {
    if (sessionId) localStorage.setItem(SESSION_KEY, sessionId)
    if (label) localStorage.setItem(LABEL_KEY, label)
  } catch {
    // Private mode without storage — the session just won't survive a reload.
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(LABEL_KEY)
  } catch {
    /* ignore */
  }
}

async function parseError(res, fallback) {
  try {
    const body = await res.json()
    return body?.error || fallback
  } catch {
    return fallback
  }
}

// Exchanges a WhatsApp link token (`?t=...`) for a session. Throws if the
// token is missing, invalid, or has been revoked.
export async function linkWithToken(token) {
  const res = await fetch('/api/auth/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!res.ok) throw new Error(await parseError(res, 'That link is invalid or has expired.'))
  const data = await res.json()
  setSession(data.sessionId, data.label)
  return data
}

// Re-checks the stored session against the server (used to confirm access
// hasn't been revoked). The app trusts a locally stored session id by
// default so it keeps working offline — this is an explicit, occasional
// confirmation, not something called on every render.
export async function checkSession() {
  const sessionId = getSessionId()
  if (!sessionId) return null
  try {
    const res = await fetch('/api/auth/session', { headers: { 'X-Session-Id': sessionId } })
    if (!res.ok) {
      clearSession()
      return null
    }
    return res.json()
  } catch {
    // Offline or unreachable — keep trusting the locally stored session.
    return { label: getMemberLabel(), offline: true }
  }
}
