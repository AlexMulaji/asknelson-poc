import crypto from 'node:crypto'

// Randomised display handles.
//
// Members sign up with a mobile number, and the app used to fall back to
// showing that number wherever a name was needed — a personal identifier on
// screen, visible to anyone glancing at the phone. Every account now gets a
// generated handle instead ("CalmRiver4821"), stored in auth_users.username,
// which is what the app displays.
//
// The word lists are deliberately neutral: nothing about mood, health,
// gender or age, so a handle can never imply something about the person
// behind it. Both lists are chosen to be unambiguous when read aloud.

export const ADJECTIVES = [
  'Amber', 'Bright', 'Calm', 'Clever', 'Coastal', 'Copper', 'Crisp', 'Daring',
  'Eager', 'Early', 'Equal', 'Fair', 'Fleet', 'Gentle', 'Golden', 'Green',
  'Happy', 'Honest', 'Jade', 'Keen', 'Kind', 'Lively', 'Lucky', 'Mellow',
  'Merry', 'Mild', 'Noble', 'Nimble', 'Open', 'Patient', 'Quick', 'Quiet',
  'Rapid', 'Ready', 'Royal', 'Silver', 'Simple', 'Smooth', 'Solid', 'Steady',
  'Still', 'Sunny', 'Swift', 'Tidy', 'True', 'Vivid', 'Warm', 'Wise',
]

export const NOUNS = [
  'Acorn', 'Anchor', 'Arrow', 'Aspen', 'Beacon', 'Bloom', 'Branch', 'Breeze',
  'Brook', 'Canyon', 'Cedar', 'Cloud', 'Comet', 'Compass', 'Coral', 'Cove',
  'Delta', 'Dune', 'Ember', 'Fern', 'Forest', 'Garden', 'Harbour', 'Harvest',
  'Hollow', 'Island', 'Lantern', 'Ledge', 'Maple', 'Meadow', 'Meridian',
  'Mesa', 'Orbit', 'Orchard', 'Pebble', 'Pine', 'Prairie', 'Quarry', 'Reef',
  'Ridge', 'River', 'Summit', 'Thicket', 'Trail', 'Valley', 'Willow',
]

// Four digits keep the handle short while giving the two word lists
// 48 * 46 * 9000 ≈ 19.9 million combinations — collisions stay rare enough
// that allocateUsername() almost always succeeds on its first try.
const MIN_SUFFIX = 1000
const MAX_SUFFIX = 9999

/** The shape allocateUsername() produces, for callers that need to validate. */
export const GENERATED_USERNAME_RE = /^[A-Z][a-z]+[A-Z][a-z]+\d{4}$/

/**
 * One random handle. Uses crypto.randomInt rather than Math.random: handles
 * are shown to the member as their identity, and a predictable sequence would
 * let one account guess the next.
 */
export function generateUsername(random = crypto.randomInt) {
  const adjective = ADJECTIVES[random(ADJECTIVES.length)]
  const noun = NOUNS[random(NOUNS.length)]
  const suffix = random(MIN_SUFFIX, MAX_SUFFIX + 1)
  return `${adjective}${noun}${suffix}`
}

/**
 * A handle nobody else holds. Usernames are compared case-insensitively
 * throughout, so the check is too.
 *
 * `db` is anything with a pg-style `query`, which lets this run inside the
 * registration transaction — the uniqueness check and the INSERT then see the
 * same snapshot, and the UNIQUE index catches the race if two registrations
 * land on the same handle between the SELECT and the INSERT.
 *
 * @throws when `attempts` handles in a row are already taken, which means the
 *         name space is exhausted rather than that this caller was unlucky.
 */
export async function allocateUsername(db, { attempts = 8, random = crypto.randomInt } = {}) {
  for (let i = 0; i < attempts; i++) {
    const candidate = generateUsername(random)
    const { rows } = await db.query('SELECT 1 FROM auth_users WHERE lower(username) = lower($1)', [
      candidate,
    ])
    if (rows.length === 0) return candidate
  }
  throw new Error(`Could not allocate a free username after ${attempts} attempts`)
}
