// Publishing state for the editable content datasets.
//
// Content used to go live the moment it was saved, which made "save" and
// "publish" the same action and gave everyone who could edit the power to
// change what every member sees. Each item now carries a `published` flag:
//
//   * the public GET /api/content/:key serves only published items
//   * the admin editor sees everything, drafts marked as such
//   * changing a flag needs content:publish, while editing needs only
//     content:write — see publishChanges() below
//
// A missing flag means published. That keeps every item written before this
// existed live, and means a hand-edited or imported JSON file behaves the way
// whoever wrote it expects.

/**
 * How to find the publishable items in each dataset. `child` names a nested
 * list whose items publish independently of their parent — an Explore tile can
 * be pulled without hiding the whole theme.
 */
export const PUBLISHABLE = Object.freeze({
  explore: {
    kind: 'theme',
    list: (doc) => doc?.explore?.themes ?? [],
    set: (doc, list) => ({ ...doc, explore: { ...(doc?.explore ?? {}), themes: list } }),
    child: { kind: 'tile', key: 'content' },
  },
  journeys: {
    kind: 'journey',
    list: (doc) => doc?.journeys ?? [],
    set: (doc, list) => ({ ...doc, journeys: list }),
  },
  assessments: {
    kind: 'assessment',
    list: (doc) => doc?.assessments ?? [],
    set: (doc, list) => ({ ...doc, assessments: list }),
  },
})

/** Items are live unless explicitly held back, so legacy content stays live. */
export function isPublished(item) {
  return item?.published !== false
}

/** A stable handle for one item, used as the key when diffing two documents. */
function refFor(kind, item, index, parentRef = null) {
  const id = item?.id ?? item?.day ?? `#${index}`
  const own = `${kind}:${id}`
  return parentRef ? `${parentRef}/${own}` : own
}

/**
 * Every publishable item in a dataset, flattened.
 * @returns {Array<{ref:string, kind:string, id:string, title:string|null, published:boolean, parentRef:string|null}>}
 */
export function publishableItems(key, doc) {
  const spec = PUBLISHABLE[key]
  if (!spec) return []
  const out = []
  spec.list(doc).forEach((item, index) => {
    const ref = refFor(spec.kind, item, index)
    out.push({
      ref,
      kind: spec.kind,
      id: String(item?.id ?? index),
      title: item?.title ?? null,
      published: isPublished(item),
      parentRef: null,
    })
    if (!spec.child) return
    const children = Array.isArray(item?.[spec.child.key]) ? item[spec.child.key] : []
    children.forEach((child, childIndex) => {
      out.push({
        ref: refFor(spec.child.kind, child, childIndex, ref),
        kind: spec.child.kind,
        id: String(child?.id ?? childIndex),
        title: child?.title ?? null,
        published: isPublished(child),
        parentRef: ref,
      })
    })
  })
  return out
}

/**
 * The dataset as members should see it: unpublished items removed, and the
 * `published` flag itself stripped so the flag is never shipped to the client.
 * An unpublished parent takes its children with it.
 */
export function filterPublished(key, doc) {
  const spec = PUBLISHABLE[key]
  if (!spec || !doc) return doc

  const kept = spec.list(doc)
    .filter(isPublished)
    .map((item) => {
      const { published, ...rest } = item ?? {}
      if (!spec.child) return rest
      const children = rest[spec.child.key]
      if (!Array.isArray(children)) return rest
      return {
        ...rest,
        [spec.child.key]: children.filter(isPublished).map(({ published: _p, ...child }) => child),
      }
    })

  return spec.set(doc, kept)
}

/**
 * What changed about what members can see, between two versions of a dataset.
 *
 * Three things count as a publishing decision, not an edit:
 *   published  — a draft going live, or live content being pulled
 *   created    — a brand new item that arrives already live
 *   removed    — deleting an item that was live, which takes it off the app
 *
 * Editing the words of a live article is none of those, so an editor can fix a
 * typo on the front page without holding content:publish. Creating a *draft*
 * is likewise free; only the moment it becomes visible is gated.
 *
 * @returns {Array<{ref:string, kind:string, title:string|null, change:'published'|'unpublished'|'created'|'removed'}>}
 */
export function publishChanges(key, before, after) {
  const from = new Map(publishableItems(key, before).map((i) => [i.ref, i]))
  const to = new Map(publishableItems(key, after).map((i) => [i.ref, i]))
  const changes = []

  for (const [ref, item] of to) {
    const previous = from.get(ref)
    if (!previous) {
      if (item.published) changes.push({ ref, kind: item.kind, title: item.title, change: 'created' })
    } else if (previous.published !== item.published) {
      changes.push({
        ref,
        kind: item.kind,
        title: item.title,
        change: item.published ? 'published' : 'unpublished',
      })
    }
  }

  for (const [ref, item] of from) {
    if (!to.has(ref) && item.published) {
      changes.push({ ref, kind: item.kind, title: item.title, change: 'removed' })
    }
  }

  return changes
}

/**
 * Flip one item's flag. Used by the explicit publish/unpublish endpoint, which
 * needs to change visibility without sending the whole dataset back — so an
 * editor's unsaved draft in another tab can never ride along with it.
 *
 * @returns {{doc:object, item:object}|null} null when `ref` matches nothing.
 */
export function setPublished(key, doc, ref, published) {
  const spec = PUBLISHABLE[key]
  if (!spec) return null
  let found = null

  const list = spec.list(doc).map((item, index) => {
    const itemRef = refFor(spec.kind, item, index)
    if (itemRef === ref) {
      found = { ref: itemRef, kind: spec.kind, title: item?.title ?? null }
      return { ...item, published }
    }
    if (!spec.child || !ref.startsWith(`${itemRef}/`)) return item
    const children = Array.isArray(item?.[spec.child.key]) ? item[spec.child.key] : []
    return {
      ...item,
      [spec.child.key]: children.map((child, childIndex) => {
        const childRef = refFor(spec.child.kind, child, childIndex, itemRef)
        if (childRef !== ref) return child
        found = { ref: childRef, kind: spec.child.kind, title: child?.title ?? null }
        return { ...child, published }
      }),
    }
  })

  return found ? { doc: spec.set(doc, list), item: found } : null
}
