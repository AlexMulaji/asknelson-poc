import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterPublished, publishableItems, setPublished } from '../server/content.js'
import { childRef, filterPublishedDoc, itemRef } from '../src/lib/publishRef.js'

// The editor computes an item's ref in the browser; the server computes it
// again when the publish request arrives. If those two ever disagree the
// publish button silently targets nothing — a failure with no error message
// anywhere, which is the worst kind.
//
// So rather than checking the client against a hard-coded list, check it
// against the server's own output.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataset = (key) => JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data', `${key}.json`), 'utf8'))

/** Every ref the editor would produce for a dataset, in the same order. */
function clientRefs(key, doc) {
  const specs = {
    explore: { kind: 'theme', list: doc?.explore?.themes ?? [], childKind: 'tile', childKey: 'content' },
    journeys: { kind: 'journey', list: doc?.journeys ?? [] },
    assessments: { kind: 'assessment', list: doc?.assessments ?? [] },
  }
  const spec = specs[key]
  const refs = []
  spec.list.forEach((item, index) => {
    const ref = itemRef(spec.kind, item, index)
    refs.push(ref)
    if (!spec.childKind) return
    const children = Array.isArray(item?.[spec.childKey]) ? item[spec.childKey] : []
    children.forEach((child, childIndex) => {
      refs.push(childRef(ref, spec.childKind, child, childIndex))
    })
  })
  return refs
}

for (const key of ['explore', 'journeys', 'assessments']) {
  test(`client and server agree on every ref in ${key}`, () => {
    const doc = dataset(key)
    const server = publishableItems(key, doc).map((i) => i.ref)
    assert.ok(server.length > 0, `${key} has no publishable items`)
    assert.deepEqual(clientRefs(key, doc), server)
  })
}

test('a ref the editor computes is one the server can act on', () => {
  // End to end, over the real bundled content: take a ref the way the editor
  // would, and confirm setPublished() finds exactly that item.
  const doc = dataset('explore')
  const theme = doc.explore.themes[1]
  const tile = theme.content[0]

  const themeRef = itemRef('theme', theme, 1)
  assert.ok(setPublished('explore', doc, themeRef, false))

  const tileRef = childRef(themeRef, 'tile', tile, 0)
  const result = setPublished('explore', doc, tileRef, false)
  assert.equal(result.item.title, tile.title)
})

test('items with no id fall back to the same handle on both sides', () => {
  // Hand-edited JSON can be missing an id; a journey day uses its number.
  const doc = { journeys: [{ title: 'No id' }, { day: 4, title: 'By day' }] }
  assert.deepEqual(
    clientRefs('journeys', doc),
    publishableItems('journeys', doc).map((i) => i.ref)
  )
})

for (const key of ['explore', 'journeys', 'assessments']) {
  test(`client and server filter ${key} identically`, () => {
    // The bundled copy is filtered in the browser (offline, and the first
    // paint); the served copy is filtered on the server. A member must see the
    // same thing either way.
    const doc = dataset(key)
    assert.deepEqual(filterPublishedDoc(key, doc), filterPublished(key, doc))
  })
}

test('the two filters agree once items are held back', () => {
  const doc = {
    explore: {
      themes: [
        { id: 'a', content: [{ id: 'a1' }, { id: 'a2', published: false }] },
        { id: 'b', published: false, content: [{ id: 'b1' }] },
      ],
    },
  }
  assert.deepEqual(filterPublishedDoc('explore', doc), filterPublished('explore', doc))
  // And both actually removed something.
  assert.equal(filterPublishedDoc('explore', doc).explore.themes.length, 1)
})

test('the bundled content ships nothing unpublished', () => {
  // A draft committed into src/data would be invisible in the app but present
  // in the bundle, which is a confusing thing to debug later.
  for (const key of ['explore', 'journeys', 'assessments']) {
    const drafts = publishableItems(key, dataset(key)).filter((i) => !i.published)
    assert.deepEqual(drafts, [], `${key} ships drafts: ${drafts.map((d) => d.ref).join(', ')}`)
  }
})
