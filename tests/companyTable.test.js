import test from 'node:test'
import assert from 'node:assert/strict'
import { filterCompanies, formatDuration } from '../src/lib/companyTable.js'

// --- formatDuration ------------------------------------------------------------

test('formats durations at each scale', () => {
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(45), '45s')
  assert.equal(formatDuration(60), '1m')
  assert.equal(formatDuration(59 * 60 + 59), '59m')
  assert.equal(formatDuration(3 * 3600 + 5 * 60), '3h 05m')
  assert.equal(formatDuration(2 * 86400 + 4 * 3600), '2d 4h')
})

test('treats missing or bad input as zero rather than NaN', () => {
  assert.equal(formatDuration(null), '0s')
  assert.equal(formatDuration(undefined), '0s')
  assert.equal(formatDuration('abc'), '0s')
  assert.equal(formatDuration(-30), '0s')
  // bigint columns can arrive from pg as strings.
  assert.equal(formatDuration('120'), '2m')
})

// --- filterCompanies -----------------------------------------------------------

const rows = [
  { id: 'a', name: 'Acme', events: 120, sessions: 30, members: 12, time_spent_seconds: 3600 },
  { id: 'b', name: 'Bravo Ltd', events: 40, sessions: 10, members: 3, time_spent_seconds: 7200 },
  { id: 'c', name: 'Charlie', events: 0, sessions: 0, members: 0, time_spent_seconds: 0 },
]

test('sorts by events, busiest first, by default', () => {
  assert.deepEqual(filterCompanies(rows).map((r) => r.id), ['a', 'b', 'c'])
})

test('sorts by time in app and by name', () => {
  const byTime = filterCompanies(rows, { sortBy: 'time_spent_seconds', direction: 'desc' })
  assert.deepEqual(byTime.map((r) => r.id), ['b', 'a', 'c'])
  const byName = filterCompanies(rows, { sortBy: 'name', direction: 'asc' })
  assert.deepEqual(byName.map((r) => r.id), ['a', 'b', 'c'])
})

test('searches company names case-insensitively', () => {
  assert.deepEqual(filterCompanies(rows, { search: 'BRAV' }).map((r) => r.id), ['b'])
  assert.deepEqual(filterCompanies(rows, { search: '  ' }).length, 3)
})

test('applies minimum events and unique users', () => {
  assert.deepEqual(filterCompanies(rows, { minEvents: 1 }).map((r) => r.id), ['a', 'b'])
  assert.deepEqual(filterCompanies(rows, { minUsers: '5' }).map((r) => r.id), ['a'])
  // An empty input means "no minimum", not "zero or NaN excludes everything".
  assert.equal(filterCompanies(rows, { minUsers: '' }).length, 3)
})

test('narrows to the globally selected company', () => {
  assert.deepEqual(filterCompanies(rows, { organisationId: 'c' }).map((r) => r.id), ['c'])
})

test('does not mutate the input', () => {
  const copy = rows.map((r) => ({ ...r }))
  filterCompanies(rows, { sortBy: 'name', direction: 'desc' })
  assert.deepEqual(rows, copy)
})
