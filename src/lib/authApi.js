// Thin client for /api/auth. The session lives in an httpOnly cookie, so there
// is no token to store or attach here — `credentials: 'same-origin'` is enough
// and the token stays unreachable from JavaScript.

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api/auth${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

/** Who am I? Returns { user: null } when signed out — not an error. */
export const fetchMe = () => request('/me')

/** Create the pending account and send the first PIN. */
export const startRegistration = (payload) =>
  request('/register/start', { method: 'POST', body: payload })

export const resendOtp = (userId, channel) =>
  request('/register/resend', { method: 'POST', body: { userId, channel } })

/** Verify the PIN — this activates the account and signs the user in. */
export const verifyOtp = (userId, code) =>
  request('/register/verify', { method: 'POST', body: { userId, code } })

export const login = (identifier, password) =>
  request('/login', { method: 'POST', body: { identifier, password } })

export const logout = () => request('/logout', { method: 'POST' })

export const checkUsername = (username) =>
  request(`/username-available?username=${encodeURIComponent(username)}`)
