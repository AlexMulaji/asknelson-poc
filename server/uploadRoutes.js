import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PERMISSIONS as P, requirePermission } from './rbac.js'
import { MAX_IMAGE_DIMENSION, MAX_UPLOAD_BYTES, formatBytes, validateUpload } from './images.js'

// The media library behind every `type: 'image'` field in the admin editor.
//
// Uploads are capped twice over, because the images behind the cards are the
// single biggest thing between a member on mobile data and a screen that has
// finished loading:
//
//   in the browser  the editor downscales to 1600px and re-encodes to WebP
//                   before sending (src/lib/imageCompression.js), so the
//                   original never crosses the network
//   here            a hard byte limit and a pixel-dimension limit, because a
//                   browser can be bypassed and a 12 MP camera JPEG behind a
//                   journey card is a multi-second stall however it arrived

const UPLOAD_EXTENSIONS = ['png', 'jpg', 'gif', 'webp']

export function createUploadRouter({ uploadDir, audit = () => {} }) {
  const router = express.Router()

  // Keep a readable slug of the original filename so the library is browsable,
  // and suffix a content hash so re-uploading the same file is a no-op rather
  // than a duplicate.
  function uploadFilename(originalName, buf, ext) {
    const base =
      path
        .basename(String(originalName || 'image'), path.extname(String(originalName || '')))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'image'
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8)
    return `${base}-${hash}.${ext}`
  }

  // Guard against `..` and nested paths in user-supplied names.
  function resolveUpload(name) {
    const safe = path.basename(String(name || ''))
    if (!safe || safe.startsWith('.')) return null
    const full = path.join(uploadDir, safe)
    if (path.dirname(full) !== uploadDir) return null
    return { name: safe, full }
  }

  function listUploads() {
    if (!fs.existsSync(uploadDir)) return []
    return fs
      .readdirSync(uploadDir)
      .filter((name) => UPLOAD_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(`.${ext}`)))
      .map((name) => {
        const stat = fs.statSync(path.join(uploadDir, name))
        return { name, url: `/uploads/${name}`, size: stat.size, modified: stat.mtimeMs }
      })
      .sort((a, b) => b.modified - a.modified)
  }

  router.get('/', requirePermission(P.MEDIA_READ), (_req, res) => {
    try {
      res.set('Cache-Control', 'no-store')
      res.json({
        uploads: listUploads(),
        // Shown in the editor, so nobody has to discover the limits by being
        // refused by them.
        limits: { maxBytes: MAX_UPLOAD_BYTES, maxDimension: MAX_IMAGE_DIMENSION },
      })
    } catch (err) {
      console.error('[asknelson] failed to list uploads:', err)
      res.status(500).json({ error: 'Failed to list uploads' })
    }
  })

  // The image arrives as a raw body rather than multipart, which keeps the
  // server dependency-free; the original filename rides along as ?name=.
  //
  // The body limit rejects with a 413 before the bytes are buffered;
  // validateUpload() then re-checks the size (so the message can name the
  // actual figure) along with the format and the pixel dimensions.
  router.post(
    '/',
    requirePermission(P.MEDIA_WRITE),
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    (req, res) => {
      const verdict = validateUpload(req.body)
      if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error })

      const name = uploadFilename(req.query.name, req.body, verdict.kind.ext)
      const target = path.join(uploadDir, name)
      try {
        fs.mkdirSync(uploadDir, { recursive: true })
        // Same bytes, same name — an existing file is already correct, so skip
        // the rewrite and just hand back the URL.
        if (!fs.existsSync(target)) {
          const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`
          fs.writeFileSync(tmp, req.body)
          fs.renameSync(tmp, target)
        }
        res.json({
          ok: true,
          name,
          url: `/uploads/${name}`,
          size: req.body.length,
          sizeLabel: formatBytes(req.body.length),
          dimensions: verdict.size,
          warning: verdict.warning,
        })
      } catch (err) {
        console.error('[asknelson] failed to save upload:', err)
        res.status(500).json({ error: 'Failed to save upload' })
      }
    }
  )

  router.delete('/:name', requirePermission(P.MEDIA_DELETE), (req, res) => {
    const resolved = resolveUpload(req.params.name)
    if (!resolved) return res.status(400).json({ error: 'Invalid filename' })
    try {
      if (!fs.existsSync(resolved.full)) return res.status(404).json({ error: 'Not found' })
      fs.unlinkSync(resolved.full)
      audit(req, {
        actor: 'admin',
        actorId: req.admin.id,
        action: 'media_deleted',
        targetType: 'upload',
        targetId: resolved.name,
      })
      res.json({ ok: true })
    } catch (err) {
      console.error('[asknelson] failed to delete upload:', err)
      res.status(500).json({ error: 'Failed to delete upload' })
    }
  })

  return router
}
