// How the editor names one publishable item to the server.
//
// Mirrors refFor() in server/content.js. The two have to agree exactly — a
// mismatch means the publish button quietly targets nothing — so
// tests/publishRef.test.js checks this module against the server's own
// publishableItems() output rather than against a hard-coded list.

/** A top-level item: "theme:anxiety", "journey:grief". */
export function itemRef(kind, item, index) {
  const id = item?.id ?? item?.day ?? `#${index}`
  return `${kind}:${id}`
}

/** A nested item, under its parent: "theme:anxiety/tile:ax-01". */
export function childRef(parentRef, kind, child, index) {
  return `${parentRef}/${itemRef(kind, child, index)}`
}

/** Items are live unless explicitly held back — the same default the server uses. */
export function isPublished(item) {
  return item?.published !== false
}

// Which lists in each dataset hold independently publishable items. Mirrors
// PUBLISHABLE in server/content.js.
const PUBLISHABLE = {
  explore: {
    list: (doc) => doc?.explore?.themes ?? [],
    set: (doc, list) => ({ ...doc, explore: { ...(doc?.explore ?? {}), themes: list } }),
    childKey: 'content',
  },
  journeys: {
    list: (doc) => doc?.journeys ?? [],
    set: (doc, list) => ({ ...doc, journeys: list }),
  },
  assessments: {
    list: (doc) => doc?.assessments ?? [],
    set: (doc, list) => ({ ...doc, assessments: list }),
  },
}

/**
 * Drop unpublished items from a dataset.
 *
 * The server already does this for /api/content, so this is only for the JSON
 * bundled into the app — the copy used offline and before the first fetch
 * lands. Without it, an item pulled from the app would reappear the moment
 * somebody opened it on a plane.
 */
export function filterPublishedDoc(key, doc) {
  const spec = PUBLISHABLE[key]
  if (!spec || !doc) return doc

  const kept = spec
    .list(doc)
    .filter(isPublished)
    .map((item) => {
      const { published, ...rest } = item ?? {}
      if (!spec.childKey) return rest
      const children = rest[spec.childKey]
      if (!Array.isArray(children)) return rest
      return {
        ...rest,
        [spec.childKey]: children.filter(isPublished).map(({ published: _p, ...child }) => child),
      }
    })

  return spec.set(doc, kept)
}
