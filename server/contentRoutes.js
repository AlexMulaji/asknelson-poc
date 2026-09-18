import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PERMISSIONS as P, can, requirePermission } from './rbac.js'
import { filterPublished, publishChanges, publishableItems, setPublished } from './content.js'

// The editable content datasets: read by the PWA, written from the admin
// portal.
//
// Two permissions meet here, and keeping them apart is the point:
//
//   content:write    change the words, the images, the order
//   content:publish  change what members can actually see
//
// A save that alters no visibility needs only the first, so an editor can fix
// a typo on the front page. A save that makes something live, pulls it, or
// deletes something live needs the second as well — and because that is
// decided by diffing the incoming document against the stored one, an editor
// cannot smuggle a visibility change through inside an otherwise ordinary
// save.

/** The three datasets and the top-level key each one must carry. */
export const DATASETS = {
  explore: { rootKey: 'explore' },
  journeys: { rootKey: 'journeys' },
  assessments: { rootKey: 'assessments' },
}

/**
 * @param {object} options
 * @param {string} options.dataDir   where the live datasets are written
 * @param {string} options.seedDir   the JSON shipped with the app, for resets
 * @param {Function} [options.audit] audit sink; defaults to a no-op
 */
export function createContentRouter({ dataDir, seedDir, audit = () => {} }) {
  const router = express.Router()
  router.use(express.json({ limit: '5mb' }))

  const dataPath = (key) => path.join(dataDir, `${key}.json`)
  const readDataset = (key) => JSON.parse(fs.readFileSync(dataPath(key), 'utf8'))

  // Atomic write: write to a temp file in the same directory, then rename over
  // the target, so a crash mid-write never leaves a corrupt dataset behind.
  function writeDataset(key, value) {
    const target = dataPath(key)
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
    fs.renameSync(tmp, target)
  }

  const known = (req, res) => {
    if (DATASETS[req.params.key]) return true
    res.status(404).json({ error: 'Unknown dataset' })
    return false
  }

  // What members see: published items only, with the flag itself stripped. An
  // admin holding content:read gets the whole dataset via ?include=drafts —
  // the editor has to see what it is editing.
  router.get('/:key', (req, res) => {
    if (!known(req, res)) return
    try {
      const doc = readDataset(req.params.key)
      // Content is fetched by the PWA; keep it out of the HTTP cache so edits
      // show up on the next load (the service worker applies its own
      // NetworkFirst strategy).
      res.set('Cache-Control', 'no-store')

      if (req.query.include !== 'drafts') return res.json(filterPublished(req.params.key, doc))

      // can() is requirePermission()'s answer asked inline: this is the one
      // route where the permission changes the response rather than blocking
      // the request.
      if (!can(req.admin, P.CONTENT_READ)) {
        return res.status(403).json({ error: 'Not allowed to read draft content.' })
      }
      res.json({ ...doc, _publishing: publishableItems(req.params.key, doc) })
    } catch (err) {
      console.error(`[asknelson] failed to read ${req.params.key}:`, err)
      res.status(500).json({ error: 'Failed to read dataset' })
    }
  })

  router.put('/:key', requirePermission(P.CONTENT_WRITE), (req, res) => {
    if (!known(req, res)) return
    const { key } = req.params
    const body = req.body
    const root = body?.[DATASETS[key].rootKey]
    // Light shape check: the top-level key must exist and hold the expected
    // container (explore -> object with themes[], others -> array).
    const validShape = key === 'explore' ? Array.isArray(root?.themes) : Array.isArray(root)
    if (!validShape) {
      return res.status(400).json({
        error: `Invalid payload: expected a top-level "${DATASETS[key].rootKey}" ${
          key === 'explore' ? 'object with a themes array' : 'array'
        }.`,
      })
    }

    try {
      const changes = publishChanges(key, readDataset(key), body)
      if (changes.length && !can(req.admin, P.CONTENT_PUBLISH)) {
        return res.status(403).json({
          error: `Your role (${req.admin.role}) can edit content but not publish it.`,
          required: P.CONTENT_PUBLISH,
          publishChanges: changes,
        })
      }

      writeDataset(key, body)
      if (changes.length) {
        audit(req, {
          actor: 'admin',
          actorId: req.admin.id,
          action: 'content_publish_changed',
          targetType: 'dataset',
          targetId: key,
          details: { changes },
        })
      }
      res.json({ ok: true, publishChanges: changes })
    } catch (err) {
      console.error(`[asknelson] failed to write ${key}:`, err)
      res.status(500).json({ error: 'Failed to save dataset' })
    }
  })

  /**
   * Publish or unpublish one item, named by the ref that publishableItems()
   * reports. Separate from the PUT so visibility can change without sending
   * the whole dataset back — somebody's unsaved draft in another tab can never
   * ride along with a publish.
   */
  router.post('/:key/publish', requirePermission(P.CONTENT_PUBLISH), (req, res) => {
    if (!known(req, res)) return
    const { key } = req.params
    const ref = String(req.body?.ref ?? '')
    const published = req.body?.published !== false
    if (!ref) return res.status(400).json({ error: 'ref is required' })

    try {
      const result = setPublished(key, readDataset(key), ref, published)
      if (!result) return res.status(404).json({ error: `Nothing in ${key} matches "${ref}".` })
      writeDataset(key, result.doc)
      audit(req, {
        actor: 'admin',
        actorId: req.admin.id,
        action: published ? 'content_published' : 'content_unpublished',
        targetType: 'content',
        targetId: ref,
        details: { dataset: key, title: result.item.title },
      })
      res.json({ ok: true, item: { ...result.item, published } })
    } catch (err) {
      console.error(`[asknelson] failed to change publish state on ${key}:`, err)
      res.status(500).json({ error: 'Failed to change publishing state' })
    }
  })

  // Reset a dataset back to the JSON shipped with the app. That republishes
  // everything the seed contains, so it needs the publish permission.
  router.post('/:key/reset', requirePermission(P.CONTENT_PUBLISH), (req, res) => {
    if (!known(req, res)) return
    const { key } = req.params
    try {
      const value = JSON.parse(fs.readFileSync(path.join(seedDir, `${key}.json`), 'utf8'))
      writeDataset(key, value)
      audit(req, {
        actor: 'admin',
        actorId: req.admin.id,
        action: 'content_reset',
        targetType: 'dataset',
        targetId: key,
      })
      res.json({ ok: true, data: value })
    } catch (err) {
      console.error(`[asknelson] failed to reset ${key}:`, err)
      res.status(500).json({ error: 'Failed to reset dataset' })
    }
  })

  return router
}
