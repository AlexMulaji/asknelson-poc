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

// --- media library ----------------------------------------------------------

export async function listUploads() {
  const res = await fetch('/api/admin/uploads', {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${getAdminKey()}` },
  })
  if (res.status === 401) {
    setAdminKey('')
    throw new Error('Session expired — please log in again.')
  }
  if (!res.ok) throw new Error(await parseError(res, 'Failed to load uploads'))
  const body = await res.json()
  return body.uploads ?? []
}

// Posts the raw file bytes; the server sniffs the real format and ignores the
// declared content type.
export async function uploadImage(file) {
  const res = await fetch(`/api/admin/uploads?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      Authorization: `Bearer ${getAdminKey()}`,
    },
    body: file,
  })
  if (res.status === 401) {
    setAdminKey('')
    throw new Error('Session expired — please log in again.')
  }
  if (res.status === 413) throw new Error('That image is too large (8 MB max).')
  if (!res.ok) throw new Error(await parseError(res, 'Upload failed'))
  return res.json()
}

export async function deleteUpload(name) {
  const res = await fetch(`/api/admin/uploads/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getAdminKey()}` },
  })
  if (res.status === 401) {
    setAdminKey('')
    throw new Error('Session expired — please log in again.')
  }
  if (!res.ok) throw new Error(await parseError(res, 'Failed to delete image'))
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
