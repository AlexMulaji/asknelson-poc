import test from 'node:test'
import assert from 'node:assert/strict'
import { runCta } from '../src/lib/assessmentCta.js'

// Where an assessment result's call to action leads. The AskNelson page is
// gone: anything that used to open it -- and anything unrecognised -- must now
// raise the Get Help dialog, because on a results screen the safe default is
// always a route to a person.

function harness() {
  const calls = { navigate: [], switchJourney: [], openHelp: [] }
  return {
    calls,
    deps: {
      navigate: (to) => calls.navigate.push(to),
      switchJourney: (id) => calls.switchJourney.push(id),
      openHelp: (source) => calls.openHelp.push(source),
    },
  }
}

test('an asknelson CTA opens Get Help instead of navigating', () => {
  const { calls, deps } = harness()
  runCta({ type: 'asknelson', label: 'Talk to someone' }, deps)
  assert.deepEqual(calls.openHelp, ['result'])
  assert.deepEqual(calls.navigate, [])
})

test('a missing or unknown CTA falls back to Get Help', () => {
  for (const cta of [undefined, null, {}, { type: 'something-new' }]) {
    const { calls, deps } = harness()
    runCta(cta, deps)
    assert.equal(calls.openHelp.length, 1, JSON.stringify(cta))
    assert.deepEqual(calls.navigate, [])
  }
})

test('the source label is passed through, so the safety screen reports as such', () => {
  const { calls, deps } = harness()
  runCta({ type: 'asknelson' }, { ...deps, source: 'safety' })
  assert.deepEqual(calls.openHelp, ['safety'])
})

test('a journey CTA switches journey and lands on My Wellness', () => {
  const { calls, deps } = harness()
  runCta({ type: 'journey', target: 'anxiety' }, deps)
  assert.deepEqual(calls.switchJourney, ['anxiety'])
  assert.deepEqual(calls.navigate, ['/my-wellness'])
  assert.deepEqual(calls.openHelp, [])
})

test('an explore CTA deep-links the theme', () => {
  const { calls, deps } = harness()
  runCta({ type: 'explore', target: 'sleep & rest' }, deps)
  assert.deepEqual(calls.navigate, ['/explore?theme=sleep%20%26%20rest'])
})
