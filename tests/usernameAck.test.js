import test from 'node:test'
import assert from 'node:assert/strict'
import m007 from '../server/migrations/007_username_acknowledged.js'

// The "you've been given an anonymous username" screen is remembered by a
// column added in migration 007. It runs on boot against live databases, so
// what matters is that it is purely additive.

test('007 adds a nullable column, idempotently', () => {
  assert.equal(m007.name, '007_username_acknowledged')
  const sql = m007.sql.replace(/\s+/g, ' ')
  assert.match(sql, /ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS username_acknowledged_at timestamptz/i)
})

test('007 leaves existing rows NULL, so existing members see the screen once', () => {
  // No default and no NOT NULL: either would mark every current account as
  // having already seen it (and a default would also rewrite the table).
  assert.doesNotMatch(m007.sql, /DEFAULT/i)
  assert.doesNotMatch(m007.sql, /NOT NULL/i)
  assert.equal(m007.run, undefined, 'no backfill step')
})
