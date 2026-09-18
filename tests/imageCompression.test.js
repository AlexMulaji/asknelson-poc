import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DIMENSION,
  QUALITY,
  SKIP_UNDER_BYTES,
  compressImage,
  fitWithin,
  formatBytes,
  renameTo,
  shouldCompress,
} from '../src/lib/imageCompression.js'

// The browser-side downscale that keeps the cards fast. The canvas work needs
// a DOM, so what is tested here is the decision-making around it — which is
// where the bugs that would actually hurt live: scaling up, distorting an
// aspect ratio, or silently flattening an animated GIF.

// --- fitWithin ---------------------------------------------------------------

test('an image already within the limit is left alone', () => {
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600, scaled: false })
  // Exactly at the limit counts as within it.
  assert.deepEqual(fitWithin(1600, 900, 1600), { width: 1600, height: 900, scaled: false })
})

test('never scales an image up', () => {
  // Upscaling costs bytes and adds nothing: the browser would just be
  // interpolating detail that is not there.
  const result = fitWithin(200, 100, 1600)
  assert.equal(result.width, 200)
  assert.equal(result.scaled, false)
})

test('scales the longest side down to the limit', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200, scaled: true })
  // Portrait: the height is what is capped.
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600, scaled: true })
  // Square.
  assert.deepEqual(fitWithin(2400, 2400, 1600), { width: 1600, height: 1600, scaled: true })
})

test('the aspect ratio survives the scale', () => {
  // Off by a pixel on one axis shows as a hairline crop on a full-bleed hero.
  for (const [w, h] of [
    [4032, 3024],
    [3000, 2000],
    [1920, 1080],
    [2160, 3840],
    [4000, 1000],
  ]) {
    const scaled = fitWithin(w, h, 1600)
    const before = w / h
    const after = scaled.width / scaled.height
    assert.ok(Math.abs(before - after) / before < 0.005, `${w}x${h} became ${scaled.width}x${scaled.height}`)
  }
})

test('an extreme ratio still gets at least one pixel on the short side', () => {
  const panorama = fitWithin(10000, 3, 1600)
  assert.equal(panorama.width, 1600)
  assert.ok(panorama.height >= 1, 'the short side rounded away to nothing')
})

test('nonsense dimensions produce nothing rather than NaN', () => {
  for (const [w, h] of [
    [0, 100],
    [100, 0],
    [-5, 100],
    [NaN, 100],
    [undefined, undefined],
  ]) {
    const result = fitWithin(w, h, 1600)
    assert.equal(result.width, 0)
    assert.equal(result.scaled, false)
  }
})

// --- shouldCompress -----------------------------------------------------------

test('compresses the photographic formats', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(shouldCompress({ type, size: 2 * 1024 * 1024 }), true, type)
  }
})

test('never touches an animated GIF', () => {
  // A canvas re-encode would keep the first frame and silently drop the
  // animation — worse than leaving a big file alone.
  assert.equal(shouldCompress({ type: 'image/gif', size: 5 * 1024 * 1024 }), false)
})

test('leaves small files alone', () => {
  // Re-encoding small PNG UI art usually makes it bigger.
  assert.equal(shouldCompress({ type: 'image/png', size: 40 * 1024 }), false)
  assert.equal(shouldCompress({ type: 'image/png', size: SKIP_UNDER_BYTES }), false)
  assert.equal(shouldCompress({ type: 'image/png', size: SKIP_UNDER_BYTES + 1 }), true)
})

test('ignores files that are not images at all', () => {
  assert.equal(shouldCompress({ type: 'application/pdf', size: 9e6 }), false)
  assert.equal(shouldCompress({ type: 'image/svg+xml', size: 9e6 }), false)
  assert.equal(shouldCompress(null), false)
  assert.equal(shouldCompress(undefined), false)
})

test('the skip threshold is configurable per call', () => {
  assert.equal(shouldCompress({ type: 'image/jpeg', size: 50 * 1024 }, { skipUnderBytes: 10 }), true)
})

// --- naming -------------------------------------------------------------------

test('the filename follows what the file now contains', () => {
  assert.equal(renameTo('holiday photo.JPG', 'image/webp'), 'holiday photo.webp')
  assert.equal(renameTo('cover.png', 'image/jpeg'), 'cover.jpg')
  // No extension to replace.
  assert.equal(renameTo('cover', 'image/webp'), 'cover.webp')
  // Dots in the name, not just the extension.
  assert.equal(renameTo('my.cover.v2.png', 'image/webp'), 'my.cover.v2.webp')
  assert.equal(renameTo('', 'image/webp'), 'image.webp')
  assert.equal(renameTo(undefined, 'image/jpeg'), 'image.jpg')
})

// --- compressImage without a DOM ------------------------------------------------

test('hands the file straight back when there is no canvas to use', async () => {
  // Node has no document; a caller must still get a usable result rather than
  // an exception, so the upload path has one branch instead of two.
  const file = { name: 'photo.jpg', type: 'image/jpeg', size: 4 * 1024 * 1024 }
  const result = await compressImage(file)
  assert.equal(result.file, file)
  assert.equal(result.compressed, false)
  assert.equal(result.originalSize, file.size)
  assert.equal(result.size, file.size)
})

test('a file below the threshold short-circuits', async () => {
  const file = { name: 'icon.png', type: 'image/png', size: 2000 }
  const result = await compressImage(file)
  assert.equal(result.compressed, false)
  assert.equal(result.file, file)
})

test('the defaults are the sizes the app actually displays', () => {
  // 1600 covers a full-bleed hero at 3x on a large phone; past that the bytes
  // are pixels nobody sees.
  assert.equal(MAX_DIMENSION, 1600)
  assert.ok(QUALITY > 0.7 && QUALITY < 0.9)
})

test('byte sizes are formatted for people', () => {
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(3.5 * 1024 * 1024), '3.5 MB')
})
