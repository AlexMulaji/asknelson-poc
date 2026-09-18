// Shrink an image in the browser before it is uploaded.
//
// The cards in Explore, Journeys and Meditate are all served straight from
// <img src>, and the images behind them were whatever the editor happened to
// have: 4000px camera JPEGs and 3 MB PNG exports. On a phone on mobile data
// that is seconds of blank card per screen, and no amount of caching helps the
// first view.
//
// Doing it here rather than on the server keeps the server dependency-free (no
// sharp, no native build) and means the large original never crosses the
// network at all. The server still enforces the same limits — see
// server/images.js — because a browser can be bypassed.

// Comfortably above the largest slot the PWA has: a full-bleed hero at 3x on a
// 430px phone is ~1290px. Past this we are sending pixels nobody will see.
export const MAX_DIMENSION = 1600
// WebP at 0.82 is visually indistinguishable from the original on photographic
// content at these sizes, and roughly a third of the equivalent JPEG.
export const QUALITY = 0.82
// Below this a re-encode usually makes the file *bigger* (small PNG UI art,
// already-optimised WebP), so the original is kept.
export const SKIP_UNDER_BYTES = 120 * 1024

// GIFs are excluded deliberately: a canvas re-encode would keep the first
// frame and silently drop the animation.
const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Scale to fit inside a square of `max`, never scaling up.
 * @returns {{width:number, height:number, scaled:boolean}}
 */
export function fitWithin(width, height, max = MAX_DIMENSION) {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0, scaled: false }
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height, scaled: false }
  const ratio = max / longest
  return {
    // round, not floor: floor loses a pixel on one axis and shifts the aspect
    // ratio just enough to show as a hairline crop on a full-bleed hero.
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  }
}

/** Whether a file is worth re-encoding at all. */
export function shouldCompress(file, { skipUnderBytes = SKIP_UNDER_BYTES } = {}) {
  if (!file) return false
  if (!COMPRESSIBLE.has(file.type)) return false
  return file.size > skipUnderBytes
}

/** Swap the extension so an upload's name matches what it now contains. */
export function renameTo(name, mimeType) {
  const extension = mimeType === 'image/webp' ? 'webp' : 'jpg'
  return `${String(name || 'image').replace(/\.[^.]+$/, '')}.${extension}`
}

// Safari only gained canvas WebP encoding in 16; older versions silently hand
// back a PNG, which would be larger than the JPEG we were trying to avoid.
function bestOutputType(canvas) {
  try {
    return canvas.toDataURL('image/webp').startsWith('data:image/webp')
      ? 'image/webp'
      : 'image/jpeg'
  } catch {
    return 'image/jpeg'
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not re-encode that image.'))),
      type,
      quality
    )
  })
}

/**
 * Downscale and re-encode a File, returning a new File ready to upload.
 *
 * Never throws for an image it simply cannot improve: a file that is already
 * small, an animated GIF, or a browser without canvas support all come back as
 * the original, so the caller has one code path. `result.compressed` says which
 * happened, and the sizes let the UI show what it saved.
 *
 * @returns {Promise<{file:File, compressed:boolean, originalSize:number,
 *                    size:number, width:number|null, height:number|null}>}
 */
export async function compressImage(
  file,
  { maxDimension = MAX_DIMENSION, quality = QUALITY, skipUnderBytes = SKIP_UNDER_BYTES } = {}
) {
  const unchanged = {
    file,
    compressed: false,
    originalSize: file?.size ?? 0,
    size: file?.size ?? 0,
    width: null,
    height: null,
  }
  if (!shouldCompress(file, { skipUnderBytes })) return unchanged
  if (typeof document === 'undefined') return unchanged

  let image
  try {
    image = await loadImage(file)
  } catch {
    // Let the server be the one to reject it, with a message about the format.
    return unchanged
  }

  const target = fitWithin(image.naturalWidth, image.naturalHeight, maxDimension)
  if (!target.width) return unchanged

  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return unchanged
  // Matters when scaling a 4000px photo down by 60%: without it, fine detail
  // aliases into visible speckle.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, target.width, target.height)

  let blob
  const type = bestOutputType(canvas)
  try {
    blob = await canvasToBlob(canvas, type, quality)
  } catch {
    return unchanged
  }

  // A re-encode that made things worse is not an improvement. Happens with
  // flat-colour PNGs, which WebP's lossy mode handles badly.
  if (blob.size >= file.size) return unchanged

  return {
    file: new File([blob], renameTo(file.name, type), { type, lastModified: Date.now() }),
    compressed: true,
    originalSize: file.size,
    size: blob.size,
    width: target.width,
    height: target.height,
  }
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}
