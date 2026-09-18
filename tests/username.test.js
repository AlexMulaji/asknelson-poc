import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADJECTIVES,
  GENERATED_USERNAME_RE,
  NOUNS,
  allocateUsername,
  generateUsername,
} from '../server/username.js'
import { accountKind, displayName, initials } from '../src/lib/accountName.js'

// Generated display handles, and what the app shows instead of a phone number.

test('a handle is two capitalised words and four digits', () => {
  for (let i = 0; i < 200; i++) {
    const username = generateUsername()
    assert.match(username, GENERATED_USERNAME_RE, username)
    assert.ok(username.length >= 8 && username.length <= 24, username)
  }
})

test('the suffix is always four digits', () => {
  for (let i = 0; i < 200; i++) {
    const suffix = generateUsername().match(/\d+$/)[0]
    assert.equal(suffix.length, 4)
    assert.ok(Number(suffix) >= 1000 && Number(suffix) <= 9999)
  }
})

test('the word lists say nothing about the person', () => {
  // A handle is shown on a mental-health app. It must not imply a mood, a
  // diagnosis, a gender or an age — nor be something anyone would mind being
  // called in front of a colleague.
  // Whole words, not substrings: "Golden" and "Willow" are fine, and a
  // substring match would reject them for containing "old" and "ill".
  const loaded = new Set(
    [
      'anxious', 'sad', 'stressed', 'depressed', 'sick', 'ill', 'broken', 'lonely',
      'man', 'woman', 'boy', 'girl', 'old', 'young', 'crazy', 'mad', 'fat', 'thin',
    ].map((w) => w.toLowerCase())
  )
  for (const word of [...ADJECTIVES, ...NOUNS]) {
    assert.equal(loaded.has(word.toLowerCase()), false, `"${word}" carries a connotation`)
    assert.match(word, /^[A-Z][a-z]+$/, `"${word}" is not a plain capitalised word`)
  }
})

test('the word lists have no duplicates', () => {
  // A duplicate silently halves the odds of that word's combinations.
  assert.equal(new Set(ADJECTIVES).size, ADJECTIVES.length)
  assert.equal(new Set(NOUNS).size, NOUNS.length)
})

test('the name space is large enough for collisions to be rare', () => {
  assert.ok(ADJECTIVES.length * NOUNS.length * 9000 > 10_000_000)
})

test('handles are not repeated in any practical sample', () => {
  const seen = new Set()
  for (let i = 0; i < 2000; i++) seen.add(generateUsername())
  // A few collisions in 2000 draws from ~20M is possible but vanishingly
  // unlikely; anything more means the randomness is not what it should be.
  assert.ok(seen.size >= 1995, `only ${seen.size} distinct handles in 2000 draws`)
})

test('handles do not come from a predictable sequence', () => {
  // Math.random() would be seeded per process and, worse, predictable from
  // earlier outputs — a handle is an identity, not a nonce.
  const first = Array.from({ length: 20 }, () => generateUsername())
  const second = Array.from({ length: 20 }, () => generateUsername())
  assert.notDeepEqual(first, second)
})

// --- allocation against the database -----------------------------------------

/** A stand-in for the pg client, answering "is this username taken?". */
function fakeDb(taken = []) {
  const set = new Set(taken.map((t) => t.toLowerCase()))
  const asked = []
  return {
    asked,
    async query(_sql, [candidate]) {
      asked.push(candidate)
      return { rows: set.has(String(candidate).toLowerCase()) ? [{ '?column?': 1 }] : [] }
    },
  }
}

test('allocates a free handle on the first try when nothing clashes', async () => {
  const db = fakeDb()
  const username = await allocateUsername(db)
  assert.match(username, GENERATED_USERNAME_RE)
  assert.equal(db.asked.length, 1)
})

test('retries past a collision', async () => {
  // A deterministic "random": the first candidate is the zeroth adjective,
  // noun and suffix, the second the first of each, and so on. That makes the
  // first candidate predictable, so it can be pre-seeded as taken.
  let round = 0
  let step = 0
  const random = (a, b) => {
    const pick = b === undefined ? round % a : a + round
    if (++step === 3) {
      step = 0
      round += 1
    }
    return pick
  }
  const first = `${ADJECTIVES[0]}${NOUNS[0]}1000`
  const db = fakeDb([first])

  const username = await allocateUsername(db, { random })
  assert.equal(db.asked[0], first, 'the seeded candidate was not tried first')
  assert.notEqual(username.toLowerCase(), first.toLowerCase())
  assert.equal(username, `${ADJECTIVES[1]}${NOUNS[1]}1001`)
  assert.equal(db.asked.length, 2)
})

test('the uniqueness check is case-insensitive', async () => {
  const db = fakeDb()
  await allocateUsername(db)
  // Otherwise "calmriver1234" and "CalmRiver1234" would be two accounts that
  // look identical wherever the handle is displayed.
  assert.match(db.asked[0], GENERATED_USERNAME_RE)
})

test('gives up loudly rather than looping forever', async () => {
  // Every candidate taken: the name space is exhausted, which is a problem to
  // report, not to retry through.
  const everythingTaken = {
    async query() {
      return { rows: [{ taken: true }] }
    },
  }
  await assert.rejects(
    () => allocateUsername(everythingTaken, { attempts: 3 }),
    /Could not allocate a free username after 3 attempts/
  )
})

// --- what the app shows -------------------------------------------------------

test('the app shows the handle, never the phone number', () => {
  const member = {
    username: 'CalmRiver4821',
    firstName: 'Thandi',
    lastName: 'Mokoena',
    phone: '27821234567',
    isAnonymous: false,
  }
  assert.equal(displayName(member), 'CalmRiver4821')
  // Neither the number itself nor any long run of its digits is rendered. (A
  // handle ends in four digits of its own, so the check is for a run long
  // enough to be part of a phone number.)
  const shown = displayName(member)
  assert.equal(shown.includes(member.phone), false)
  assert.equal(/\d{5,}/.test(shown), false)
  assert.equal(initials(member), 'CR')
})

test('a phone number is never a fallback, even with nothing else to show', () => {
  // This is the whole point: before, an account with no name fell back to the
  // mobile number, putting a personal identifier on the home screen.
  const bare = { phone: '27821234567', isAnonymous: false }
  const shown = displayName(bare)
  assert.equal(shown, 'Your account')
  assert.equal(/\d/.test(shown), false)
  assert.equal(initials(bare), 'ME')
})

test('an account from before handles existed still shows a name', () => {
  const legacy = { firstName: 'Thandi', lastName: 'Mokoena', phone: '27821234567' }
  assert.equal(displayName(legacy), 'Thandi Mokoena')
  assert.equal(initials(legacy), 'TM')
})

test('anonymous accounts show their chosen username', () => {
  const anonymous = { username: 'nightowl', isAnonymous: true }
  assert.equal(displayName(anonymous), 'nightowl')
  // Not a generated two-word handle, so fall back to the first two letters.
  assert.equal(initials(anonymous), 'NI')
  assert.equal(accountKind(anonymous), 'Anonymous account')
})

test('no user renders as nothing rather than crashing', () => {
  assert.equal(displayName(null), '')
  assert.equal(initials(undefined), '')
  assert.equal(accountKind(null), '')
})
