// What the app calls a member on screen.
//
// Every account now carries a generated handle ("CalmRiver4821"), so this is
// almost always just `username`. The fallbacks below exist for accounts created
// before that, and for the moment between sign-in and the profile arriving.
//
// The one thing that is never shown is the mobile number. It used to be the
// fallback, which put a personal identifier on the home screen where anyone
// glancing at the phone could read it — on a mental-health app, on a shared or
// work device, that is a real disclosure. A member who wants to check which
// number their account uses can still see it on their profile.

/** The name shown in the account chip, headers and greetings. */
export function displayName(user) {
  if (!user) return ''
  if (user.username) return user.username
  // Pre-handle accounts: their own name is theirs to see.
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ')
  if (full) return full
  return 'Your account'
}

/** Two letters for the avatar circle. */
export function initials(user) {
  if (!user) return ''
  if (user.username) {
    // Generated handles are two capitalised words, so the two capitals are the
    // natural initials: CalmRiver4821 -> CR.
    const capitals = user.username.match(/[A-Z]/g)
    if (capitals?.length >= 2) return capitals.slice(0, 2).join('')
    return user.username.slice(0, 2).toUpperCase()
  }
  const first = user.firstName?.[0] ?? ''
  const last = user.lastName?.[0] ?? ''
  if (first || last) return (first + last).toUpperCase()
  return 'ME'
}

/** The line under the name in the expanded account card. */
export function accountKind(user) {
  if (!user) return ''
  return user.isAnonymous ? 'Anonymous account' : 'Signed in'
}
