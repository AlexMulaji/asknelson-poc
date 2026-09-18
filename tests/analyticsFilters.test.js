import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WINDOW_DAYS,
  MAX_WINDOW_DAYS,
  buildEventFilter,
  isoDate,
  limitValue,
  offsetValue,
  windowDays,
} from '../server/analyticsFilters.js'

// Turning a query string into SQL. This is the code an unhappy visitor pokes
// first, so the rule it has to keep is simple and checkable: nothing from the
// request ever ends up in the SQL text — it either becomes a bound parameter
// or it is rejected.

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

test('defaults to a rolling window when nothing is asked for', () => {
  const filter = buildEventFilter({})
  assert.equal(filter.applied.days, DEFAULT_WINDOW_DAYS)
  assert.deepEqual(filter.params, [`${DEFAULT_WINDOW_DAYS} days`])
  assert.match(filter.where, /^WHERE e\.occurred_at > now\(\) - \$1::interval$/)
  assert.deepEqual(filter.errors, [])
})

test('clamps the window so one request cannot scan everything', () => {
  assert.equal(windowDays('1000'), MAX_WINDOW_DAYS)
  assert.equal(windowDays('0'), 1)
  assert.equal(windowDays('-5'), 1)
  assert.equal(windowDays('7.9'), 7)
  assert.equal(windowDays('nonsense'), DEFAULT_WINDOW_DAYS)
  assert.equal(windowDays(undefined), DEFAULT_WINDOW_DAYS)
  assert.equal(windowDays(Infinity), DEFAULT_WINDOW_DAYS)
})

test('an explicit date range wins over the rolling window', () => {
  const filter = buildEventFilter({ days: '7', from: '2026-02-01', to: '2026-02-28' })
  assert.equal(filter.applied.days, undefined)
  assert.deepEqual(filter.applied.from, '2026-02-01')
  assert.deepEqual(filter.applied.to, '2026-02-28')
  assert.deepEqual(filter.params, ['2026-02-01T00:00:00Z', '2026-02-28T00:00:00Z'])
  // Inclusive of the end day: people mean "up to and including the 28th".
  assert.match(filter.where, /\+ interval '1 day'/)
})

test('a half-open range works', () => {
  const from = buildEventFilter({ from: '2026-02-01' })
  assert.equal(from.params.length, 1)
  assert.equal(from.applied.to, undefined)

  const to = buildEventFilter({ to: '2026-02-01' })
  assert.equal(to.params.length, 1)
  assert.equal(to.applied.from, undefined)
})

test('rejects dates that are not real days', () => {
  assert.equal(isoDate('2026-02-31'), null)
  assert.equal(isoDate('2026-13-01'), null)
  assert.equal(isoDate('26-02-01'), null)
  assert.equal(isoDate('2026-2-1'), null)
  assert.equal(isoDate(''), null)
  assert.equal(isoDate(null), null)
  assert.equal(isoDate('2026-02-28'), '2026-02-28')
  // A leap day that exists.
  assert.equal(isoDate('2028-02-29'), '2028-02-29')
})

test('a bad date is an error, not a silently ignored filter', () => {
  // Quietly widening a report the operator asked to narrow is worse than
  // refusing it.
  const filter = buildEventFilter({ from: 'yesterday' })
  assert.deepEqual(filter.errors, ['from must be a YYYY-MM-DD date'])
})

test('the company filter binds a UUID', () => {
  const filter = buildEventFilter({ organisationId: ORG })
  assert.match(filter.where, /e\.organisation_id = \$2::uuid/)
  assert.equal(filter.params[1], ORG)
  assert.equal(filter.applied.organisationId, ORG)
})

test('a company id that is not a UUID is rejected, not interpolated', () => {
  for (const value of ["1' OR 1=1--", '; DROP TABLE analytics_events;--', 'abc', '../../etc']) {
    const filter = buildEventFilter({ organisationId: value })
    assert.deepEqual(filter.errors, ['organisationId must be a UUID'], `value ${value}`)
    assert.equal(filter.where.includes(value), false, 'the value reached the SQL text')
    assert.equal(filter.params.includes(value), false)
  }
})

test('several event names become one bound array', () => {
  const filter = buildEventFilter({ name: 'content_opened, journey_started ,' })
  assert.match(filter.where, /e\.name = ANY\(\$2::text\[\]\)/)
  assert.deepEqual(filter.params[1], ['content_opened', 'journey_started'])
})

test('an event name outside the app’s own vocabulary is rejected', () => {
  for (const value of ["x' OR '1'='1", 'name;--', 'a b', 'ünicode']) {
    const filter = buildEventFilter({ name: value })
    assert.equal(filter.errors.length, 1, `value ${value}`)
    assert.equal(filter.where.includes(value), false)
  }
})

test('a category is checked the same way', () => {
  assert.deepEqual(buildEventFilter({ category: 'journey' }).errors, [])
  assert.deepEqual(buildEventFilter({ category: "journey' --" }).errors, ['invalid category'])
})

test('filters combine, numbering their parameters in order', () => {
  const filter = buildEventFilter({
    days: '7',
    organisationId: ORG,
    name: 'content_opened',
    category: 'content',
    whatsappOnly: 'true',
  })
  assert.deepEqual(filter.errors, [])
  assert.deepEqual(filter.params, ['7 days', ORG, ['content_opened'], 'content'])
  // Placeholders must run 1..n with nothing skipped or repeated.
  const placeholders = [...filter.where.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
  assert.deepEqual(placeholders, [1, 2, 3, 4])
  assert.equal(filter.nextIndex, 5)
})

test('a caller can reserve parameter slots ahead of the filter', () => {
  // The per-company report puts the company in the path, so its own parameter
  // comes first.
  const filter = buildEventFilter({ organisationId: ORG }, { startIndex: 3 })
  const placeholders = [...filter.where.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
  assert.deepEqual(placeholders, [3, 4])
  assert.equal(filter.nextIndex, 5)
})

test('the alias and time column follow the table being queried', () => {
  const sessions = buildEventFilter({}, { alias: 's', timeColumn: 'started_at' })
  assert.match(sessions.where, /s\.started_at/)
})

test('name filters can be switched off for tables that have no such column', () => {
  const filter = buildEventFilter({ name: 'content_opened' }, { allowName: false })
  assert.equal(filter.where.includes('name'), false)
  assert.equal(filter.applied.name, undefined)
})

test('whatsappOnly only applies when it is exactly "true"', () => {
  assert.match(buildEventFilter({ whatsappOnly: 'true' }).where, /is_whatsapp = true/)
  for (const value of ['false', '1', 'yes', '']) {
    assert.equal(buildEventFilter({ whatsappOnly: value }).where.includes('is_whatsapp'), false)
  }
})

test('paging values are clamped', () => {
  assert.equal(limitValue('500'), 200)
  assert.equal(limitValue('0'), 1)
  assert.equal(limitValue(undefined), 50)
  assert.equal(limitValue('nonsense'), 50)
  assert.equal(limitValue('10', { fallback: 15, max: 20 }), 10)
  assert.equal(limitValue('30', { fallback: 15, max: 20 }), 20)

  assert.equal(offsetValue('-5'), 0)
  assert.equal(offsetValue('120'), 120)
  assert.equal(offsetValue('nonsense'), 0)
})
