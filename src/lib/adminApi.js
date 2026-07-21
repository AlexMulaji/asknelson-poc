// Thin client for the admin API. The password is kept in sessionStorage only
// (cleared when the tab closes) and sent as a Bearer token on write requests.

const STORAGE_KEY = 'asknelson-admin-key'

export function getAdminKey() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function setAdminKey(password) {
  try {
    if (password) sessionStorage.setItem(STORAGE_KEY, password)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode without storage — the session just won't survive a reload.
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

export async function adminLogin(password) {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(await parseError(res, 'Login failed'))
  setAdminKey(password)
}

export async function fetchDataset(key) {
  const res = await fetch(`/api/content/${key}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(await parseError(res, `Failed to load ${key}`))
  return res.json()
}

export async function saveDataset(key, data) {
  const res = await fetch(`/api/content/${key}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAdminKey()}`,
    },
    body: JSON.stringify(data),
  })
  if (res.status === 401) {
    setAdminKey('')
    throw new Error('Session expired — please log in again.')
  }
  if (!res.ok) throw new Error(await parseError(res, `Failed to save ${key}`))
  return res.json()
}

export async function resetDataset(key) {
  const res = await fetch(`/api/content/${key}/reset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAdminKey()}` },
  })
  if (res.status === 401) {
    setAdminKey('')
    throw new Error('Session expired — please log in again.')
  }
  if (!res.ok) throw new Error(await parseError(res, `Failed to reset ${key}`))
  return res.json()
}

// --- members (WhatsApp link identity) -----------------------------------------

async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${getAdminKey()}`,
      ...options.headers,
    },
  })
  if (res.status === 401) {
    setAdminKey('')
    throw new Error('Session expired — please log in again.')
  }
  if (!res.ok) throw new Error(await parseError(res, 'Request failed'))
  return res.json()
}

export async function fetchMembers() {
  const { members } = await adminFetch('/api/admin/members')
  return members
}

export async function createMember({ label, externalRef }) {
  return adminFetch('/api/admin/members', {
    method: 'POST',
    body: JSON.stringify({ label, externalRef }),
  })
}

export async function revokeMember(id) {
  return adminFetch(`/api/admin/members/${id}/revoke`, { method: 'POST' })
}

// --- event insights --------------------------------------------------------------

export async function fetchEventsSummary() {
  return adminFetch('/api/admin/events/summary')
}
