import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterPublished,
  isPublished,
  publishChanges,
  publishableItems,
  setPublished,
} from '../server/content.js'

// Publishing state, as pure functions. What the HTTP layer does with the
// result is covered in contentApi.test.js; this is about getting the rules
// themselves right.

const explore = () => ({
  explore: {
    themes: [
      {
        id: 'anxiety',
        title: 'Anxiety',
        content: [
          { id: 'ax-01', title: 'Live tile' },
          { id: 'ax-02', title: 'Draft tile', published: false },
        ],
      },
      { id: 'sleep', title: 'Sleep', published: false, content: [{ id: 'sl-01', title: 'Hidden' }] },
    ],
  },
})

const journeys = () => ({
  journeys: [
    { id: 'grief', title: 'Grief', days: [{ day: 1, title: 'One' }] },
    { id: 'burnout', title: 'Burnout', published: false, days: [] },
  ],
})

test('an item with no flag is published', () => {
  // Every item written before publishing existed has no flag, and must stay
  // live rather than silently disappearing on deploy.
  assert.equal(isPublished({ id: 'a' }), true)
  assert.equal(isPublished({ id: 'a', published: true }), true)
  assert.equal(isPublished({ id: 'a', published: false }), false)
})

test('filtering drops unpublished items', () => {
  const filtered = filterPublished('explore', explore())
  const themes = filtered.explore.themes
  assert.deepEqual(
    themes.map((t) => t.id),
    ['anxiety']
  )
  assert.deepEqual(
    themes[0].content.map((c) => c.id),
    ['ax-01']
  )
})

test('an unpublished parent takes its children with it', () => {
  const filtered = filterPublished('explore', explore())
  const ids = JSON.stringify(filtered)
  assert.equal(ids.includes('sl-01'), false)
})

test('the flag itself never reaches the app', () => {
  // Otherwise the PWA would ship a list of what is being held back.
  const filtered = filterPublished('explore', explore())
  assert.equal(JSON.stringify(filtered).includes('published'), false)
})

test('filtering leaves everything else untouched', () => {
  const doc = journeys()
  const filtered = filterPublished('journeys', doc)
  assert.deepEqual(filtered.journeys[0].days, [{ day: 1, title: 'One' }])
  // And does not mutate the original.
  assert.equal(doc.journeys.length, 2)
})

test('an unknown dataset is passed through rather than emptied', () => {
  const doc = { whatever: [1, 2, 3] }
  assert.deepEqual(filterPublished('unknown', doc), doc)
  assert.equal(filterPublished('explore', null), null)
})

test('publishable items are listed with stable refs', () => {
  const items = publishableItems('explore', explore())
  assert.deepEqual(
    items.map((i) => i.ref),
    ['theme:anxiety', 'theme:anxiety/tile:ax-01', 'theme:anxiety/tile:ax-02', 'theme:sleep', 'theme:sleep/tile:sl-01']
  )
  assert.equal(items.find((i) => i.ref === 'theme:sleep').published, false)
})

// --- what counts as a publishing decision -------------------------------------

test('editing the words of a live item is not a publishing change', () => {
  const before = explore()
  const after = explore()
  after.explore.themes[0].content[0].title = 'Corrected headline'
  // An editor fixing a typo on the front page must not need a publisher.
  assert.deepEqual(publishChanges('explore', before, after), [])
})

test('making a draft live is a publishing change', () => {
  const before = explore()
  const after = explore()
  after.explore.themes[0].content[1].published = true
  const changes = publishChanges('explore', before, after)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].ref, 'theme:anxiety/tile:ax-02')
  assert.equal(changes[0].change, 'published')
})

test('pulling live content is a publishing change', () => {
  const before = explore()
  const after = explore()
  after.explore.themes[0].published = false
  const changes = publishChanges('explore', before, after)
  assert.deepEqual(
    changes.map((c) => [c.ref, c.change]),
    [['theme:anxiety', 'unpublished']]
  )
})

test('creating a draft is free; creating something already live is not', () => {
  const before = explore()

  const withDraft = explore()
  withDraft.explore.themes.push({ id: 'new', title: 'New', published: false })
  assert.deepEqual(publishChanges('explore', before, withDraft), [])

  const withLive = explore()
  withLive.explore.themes.push({ id: 'new', title: 'New' })
  const changes = publishChanges('explore', before, withLive)
  assert.deepEqual(
    changes.map((c) => [c.ref, c.change]),
    [['theme:new', 'created']]
  )
})

test('deleting live content is a publishing change; deleting a draft is not', () => {
  const before = explore()

  // Removing a live item takes it off the app, which is unpublishing it by
  // another route.
  const liveGone = explore()
  liveGone.explore.themes[0].content.splice(0, 1)
  assert.deepEqual(
    publishChanges('explore', before, liveGone).map((c) => [c.ref, c.change]),
    [['theme:anxiety/tile:ax-01', 'removed']]
  )

  const draftGone = explore()
  draftGone.explore.themes[0].content.splice(1, 1)
  assert.deepEqual(publishChanges('explore', before, draftGone), [])
})

test('reordering items is not a publishing change', () => {
  const before = explore()
  const after = explore()
  after.explore.themes.reverse()
  // Refs are keyed by id, not position, so a drag-to-reorder is just an edit.
  assert.deepEqual(publishChanges('explore', before, after), [])
})

test('several changes at once are all reported', () => {
  const before = explore()
  const after = explore()
  after.explore.themes[0].content[1].published = true
  after.explore.themes[1].published = true
  const changes = publishChanges('explore', before, after)
  assert.equal(changes.length, 2)
  assert.ok(changes.every((c) => c.change === 'published'))
})

// --- setPublished ---------------------------------------------------------------

test('setPublished flips one item and leaves the rest alone', () => {
  const doc = explore()
  const result = setPublished('explore', doc, 'theme:sleep', true)
  assert.equal(result.item.title, 'Sleep')
  assert.equal(result.doc.explore.themes[1].published, true)
  // The original is untouched — the caller decides whether to write it.
  assert.equal(doc.explore.themes[1].published, false)
  // And nothing else moved.
  assert.equal(result.doc.explore.themes[0].content[1].published, false)
})

test('setPublished reaches a nested item', () => {
  const result = setPublished('explore', explore(), 'theme:anxiety/tile:ax-02', true)
  assert.equal(result.item.kind, 'tile')
  assert.equal(result.doc.explore.themes[0].content[1].published, true)
})

test('setPublished returns null for a ref that matches nothing', () => {
  for (const ref of ['theme:nope', 'theme:anxiety/tile:nope', '', 'garbage', '__proto__']) {
    assert.equal(setPublished('explore', explore(), ref, true), null, `ref ${ref}`)
  }
  assert.equal(setPublished('unknown', {}, 'theme:x', true), null)
})

test('journeys and assessments publish at the top level only', () => {
  const items = publishableItems('journeys', journeys())
  // A journey day is not independently publishable — it belongs to its journey.
  assert.deepEqual(
    items.map((i) => i.ref),
    ['journey:grief', 'journey:burnout']
  )
  const result = setPublished('journeys', journeys(), 'journey:burnout', true)
  assert.equal(result.doc.journeys[1].published, true)
})
