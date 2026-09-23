import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OWNED_TABLES,
  findCollisions,
  isTransientConnectError,
  validateSchemaName,
  waitForDatabase,
} from '../server/db.js'

// Running against a database shared with another application (Odoo): the
// schema name that ends up in a connection option, the boot-time wait for the
// database, and the guard against adopting someone else's tables. No database
// is needed — with DATABASE_URL unset, importing db.js creates no pool.

const withCode = (code) => Object.assign(new Error(code), { code })

/** A clock that only moves when the code under test sleeps. */
function fakeClock() {
  let t = 0
  const slept = []
  return {
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms)
      t += ms
    },
    slept,
  }
}

test('schema names: plain lower-case identifiers only', () => {
  for (const ok of ['asknelson', '_x', 'a1_b2', 'a'.repeat(63)]) {
    assert.equal(validateSchemaName(ok), ok)
  }
  for (const bad of ['', 'AskNelson', 'public-x', '1abc', 'asknelson; drop', 'a b', 'a'.repeat(64)]) {
    assert.throws(() => validateSchemaName(bad), /not a valid schema name/, bad)
  }
})

test('connection errors: startup-time failures are transient, the rest are not', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', '57P03']) {
    assert.ok(isTransientConnectError(withCode(code)), code)
  }
  assert.ok(isTransientConnectError(new Error('Connection terminated due to connection timeout')))
  // A refusal on a host with several addresses: empty message, inner errors.
  assert.ok(isTransientConnectError(new AggregateError([withCode('ECONNREFUSED')], '')))

  // Wrong password, missing database, missing role: waiting won't help.
  for (const code of ['28P01', '3D000', '28000']) {
    assert.equal(isTransientConnectError(withCode(code)), false, code)
  }
})

test('waitForDatabase retries until the database answers', async () => {
  const clock = fakeClock()
  let calls = 0
  await waitForDatabase({
    ping: async () => {
      if (++calls <= 2) throw withCode('ECONNREFUSED')
    },
    timeoutMs: 60_000,
    log: () => {},
    ...clock,
  })
  assert.equal(calls, 3)
  assert.deepEqual(clock.slept, [1000, 2000])
})

test('waitForDatabase backs off to a 5 second cap', async () => {
  const clock = fakeClock()
  let calls = 0
  await waitForDatabase({
    ping: async () => {
      if (++calls <= 5) throw withCode('ENOTFOUND')
    },
    timeoutMs: 60_000,
    log: () => {},
    ...clock,
  })
  assert.deepEqual(clock.slept, [1000, 2000, 4000, 5000, 5000])
})

test('waitForDatabase fails at once on a non-transient error', async () => {
  const clock = fakeClock()
  await assert.rejects(
    waitForDatabase({
      ping: async () => {
        throw withCode('28P01')
      },
      log: () => {},
      ...clock,
    }),
    { code: '28P01' }
  )
  assert.deepEqual(clock.slept, [])
})

test('waitForDatabase gives up at the deadline with the last error', async () => {
  const clock = fakeClock()
  await assert.rejects(
    waitForDatabase({
      ping: async () => {
        throw withCode('ECONNREFUSED')
      },
      timeoutMs: 10_000,
      log: () => {},
      ...clock,
    }),
    { code: 'ECONNREFUSED' }
  )
  assert.ok(clock.now() <= 10_000, `slept past the deadline: ${clock.now()}ms`)
})

test('collision guard: flags our table names, ignores everyone else’s', () => {
  // What an Odoo public schema might hold, with two of ours mixed in.
  const existing = ['res_users', 'res_partner', 'auth_users', 'ir_model', 'audit_log']
  assert.deepEqual(findCollisions(existing), ['audit_log', 'auth_users'])
  assert.deepEqual(findCollisions(['res_users', 'ir_model']), [])
  assert.deepEqual(findCollisions([]), [])
  // Bookkeeping is created before the guard runs, so it must never count.
  assert.equal(OWNED_TABLES.includes('_analytics_migrations'), false)
})
