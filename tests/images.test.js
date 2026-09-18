import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAX_IMAGE_DIMENSION,
  MAX_UPLOAD_BYTES,
  formatBytes,
  imageSize,
  sniffImage,
  validateUpload,
} from '../server/images.js'

// Upload validation. Two jobs: keep a file that is not an image out, and keep
// an image that would stall a member on mobile data out.
//
// Real files from the repo are used where possible — a synthetic header can
// agree with a bug in the parser, a JPEG that a phone actually produced
// cannot.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel))

// --- format sniffing -------------------------------------------------------------

test('recognises the formats the app serves', () => {
  assert.equal(sniffImage(read('public/icons/icon-192.png')).ext, 'png')
  assert.equal(sniffImage(read('public/media/home-hero.jpg')).ext, 'jpg')
})

test('trusts the bytes, not the extension', () => {
  // A .jpg that is really a PNG is stored as a PNG; a script renamed to .png
  // is not stored at all.
  assert.equal(sniffImage(read('public/icons/icon-192.png')).mime, 'image/png')
  assert.equal(sniffImage(Buffer.from('<?php system($_GET["c"]); ?>')), null)
})

test('refuses SVG, which can carry script', () => {
  // These are served from the app's own origin, so an SVG with an onload
  // handler would be stored XSS.
  assert.equal(sniffImage(read('public/favicon.svg')), null)
})

test('refuses empty and non-buffer input without throwing', () => {
  assert.equal(sniffImage(Buffer.alloc(0)), null)
  assert.equal(sniffImage(null), null)
  assert.equal(sniffImage('a string'), null)
  assert.equal(imageSize(Buffer.alloc(0)), null)
})

// --- dimensions -------------------------------------------------------------------

test('reads dimensions from a real PNG and JPEG', () => {
  assert.deepEqual(imageSize(read('public/icons/icon-192.png')), { width: 192, height: 192 })
  assert.deepEqual(imageSize(read('public/media/home-hero.jpg')), { width: 1024, height: 1536 })
})

test('every bundled image parses', () => {
  // A format this cannot read is one an upload would sail past the dimension
  // check on.
  const dir = path.join(ROOT, 'public/media')
  const files = fs.readdirSync(dir)
  assert.ok(files.length > 0)
  for (const name of files) {
    const buf = fs.readFileSync(path.join(dir, name))
    if (!sniffImage(buf)) continue
    const size = imageSize(buf)
    assert.ok(size && size.width > 0 && size.height > 0, `${name} has unreadable dimensions`)
  }
})

test('a truncated header is unreadable rather than an error', () => {
  const partial = read('public/media/home-hero.jpg').subarray(0, 8)
  assert.doesNotThrow(() => imageSize(partial))
  assert.equal(imageSize(partial), null)
})

test('reads a GIF header', () => {
  const gif = Buffer.alloc(10)
  gif.write('GIF89a', 0, 'latin1')
  gif.writeUInt16LE(640, 6)
  gif.writeUInt16LE(480, 8)
  assert.equal(sniffImage(gif).ext, 'gif')
  assert.deepEqual(imageSize(gif), { width: 640, height: 480 })
})

test('reads all three WebP container flavours', () => {
  const container = (fourcc, payload) => {
    const buf = Buffer.alloc(12 + 8 + payload.length)
    buf.write('RIFF', 0, 'latin1')
    buf.write('WEBP', 8, 'latin1')
    buf.write(fourcc, 12, 'latin1')
    payload.copy(buf, 20)
    return buf
  }

  // Lossy: 14-bit width/height at offsets 26 and 28.
  const lossy = Buffer.alloc(20)
  lossy.writeUInt16LE(800, 6)
  lossy.writeUInt16LE(600, 8)
  assert.deepEqual(imageSize(container('VP8 ', lossy)), { width: 800, height: 600 })

  // Lossless: 14 bits each, packed, minus one.
  const lossless = Buffer.alloc(20)
  lossless.writeUInt32LE(((600 - 1) << 14) | (800 - 1), 1)
  assert.deepEqual(imageSize(container('VP8L', lossless)), { width: 800, height: 600 })

  // Extended: 24-bit canvas size, minus one.
  const extended = Buffer.alloc(20)
  const write24 = (value, at) => {
    extended[at] = value & 0xff
    extended[at + 1] = (value >> 8) & 0xff
    extended[at + 2] = (value >> 16) & 0xff
  }
  write24(800 - 1, 4)
  write24(600 - 1, 7)
  assert.deepEqual(imageSize(container('VP8X', extended)), { width: 800, height: 600 })
})

// --- the verdict ----------------------------------------------------------------

test('accepts a reasonable image', () => {
  const verdict = validateUpload(read('public/icons/icon-192.png'))
  assert.equal(verdict.ok, true)
  assert.equal(verdict.kind.ext, 'png')
  assert.deepEqual(verdict.size, { width: 192, height: 192 })
  assert.equal(verdict.warning, null)
})

test('refuses an empty upload', () => {
  const verdict = validateUpload(Buffer.alloc(0))
  assert.equal(verdict.ok, false)
  assert.equal(verdict.status, 400)
})

test('refuses a file that is not an image, with 415', () => {
  const verdict = validateUpload(Buffer.from('not an image at all, just text'))
  assert.equal(verdict.ok, false)
  assert.equal(verdict.status, 415)
  assert.match(verdict.error, /PNG, JPG, WEBP or GIF/)
})

test('refuses an oversized file, and says how big it was', () => {
  const big = Buffer.concat([read('public/icons/icon-192.png'), Buffer.alloc(3 * 1024 * 1024)])
  const verdict = validateUpload(big, { maxBytes: 2 * 1024 * 1024 })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.status, 413)
  // The message has to name both figures, or nobody knows what to do next.
  assert.match(verdict.error, /3\.0 MB/)
  assert.match(verdict.error, /2\.0 MB/)
})

test('refuses an image with too many pixels', () => {
  // A 12 MP camera JPEG behind a card is seconds of blank space on 3G, even
  // when the file itself squeaks under the byte limit.
  const huge = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(huge)
  huge.writeUInt32BE(4032, 16)
  huge.writeUInt32BE(3024, 20)

  const verdict = validateUpload(huge)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.status, 413)
  assert.match(verdict.error, /4032×3024/)
  assert.match(verdict.error, new RegExp(String(MAX_IMAGE_DIMENSION)))
})

test('accepts an image right at the dimension limit', () => {
  const atLimit = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(atLimit)
  atLimit.writeUInt32BE(MAX_IMAGE_DIMENSION, 16)
  atLimit.writeUInt32BE(MAX_IMAGE_DIMENSION, 20)
  assert.equal(validateUpload(atLimit).ok, true)
})

test('accepts but warns about a large-but-legal file', () => {
  const chunky = Buffer.concat([read('public/icons/icon-192.png'), Buffer.alloc(600 * 1024)])
  const verdict = validateUpload(chunky)
  assert.equal(verdict.ok, true)
  assert.match(verdict.warning, /mobile data/)
})

test('an image whose dimensions cannot be read is still accepted', () => {
  // Better to store an unusual-but-valid file than to refuse it on a header
  // this parser does not understand; the byte limit still applies.
  const odd = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(2)])
  const verdict = validateUpload(odd)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.size, null)
})

test('the default limits are sane', () => {
  assert.ok(MAX_UPLOAD_BYTES > 0 && MAX_UPLOAD_BYTES <= 8 * 1024 * 1024)
  assert.ok(MAX_IMAGE_DIMENSION >= 1024 && MAX_IMAGE_DIMENSION <= 4096)
})

test('byte sizes are formatted for people', () => {
  assert.equal(formatBytes(1024), '1 KB')
  assert.equal(formatBytes(1536 * 1024), '1.5 MB')
  assert.equal(formatBytes(500), '0 KB')
})
