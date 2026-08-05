// Minimal local profile. The V1 design greets the member by name on Home, but
// sign-in is out of scope for this build — so the name lives in localStorage
// with a seeded default. Swap this module for the real session when auth lands.

const KEY = 'asknelson-profile-name'
const DEFAULT_NAME = 'Thandi'

export function getMemberName() {
  try {
    return localStorage.getItem(KEY) || DEFAULT_NAME
  } catch {
    return DEFAULT_NAME
  }
}

export function setMemberName(name) {
  try {
    if (name) localStorage.setItem(KEY, name)
    else localStorage.removeItem(KEY)
  } catch {
    // Private mode — fall back to the default for this session.
  }
}

export function greetingFor(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return 'Good Morning'
  if (h < 17) return 'Good Afternoon'
  return 'Good Evening'
}
