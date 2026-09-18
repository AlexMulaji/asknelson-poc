// Validation for uploaded imagery: what it really is, how big it is, and
// whether it is small enough to send to a member on a mobile connection.
//
// The admin editor downsizes and re-encodes images in the browser before
// upload (src/lib/imageCompression.js), which is where most of the saving
// comes from. This module is the backstop: the browser can be bypassed, and a
// 12 MP camera JPEG behind a journey card is a multi-second stall on 3G no
// matter how it got there.
//
// Dimensions are read from the file header rather than by decoding, so a
// hostile file is never rendered server-side to find out how big it is.

export const MAX_UPLOAD_BYTES = Math.round(
  Number(process.env.MAX_UPLOAD_MB || 2) * 1024 * 1024
)
// Wider than the largest slot the PWA has (a full-bleed hero on a 3x phone),
// so nothing useful is refused, but far below a modern camera's output.
export const MAX_IMAGE_DIMENSION = Number(process.env.MAX_IMAGE_DIMENSION || 2400)
// Past this, a file is almost certainly an un-optimised export: it will still
// be accepted, but the admin UI warns so somebody re-saves it.
export const WARN_BYTES = Math.round(Number(process.env.WARN_UPLOAD_KB || 400) * 1024)

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// Raster formats only. SVG is deliberately excluded: it can carry script, and
// these files are served from the app's own origin.
export const IMAGE_TYPES = [
  {
    ext: 'png',
    mime: 'image/png',
    match: (b) => b.length > 8 && b.subarray(0, 8).equals(PNG_MAGIC),
    size: pngSize,
  },
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    match: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    size: jpegSize,
  },
  {
    ext: 'gif',
    mime: 'image/gif',
    match: (b) => b.length > 6 && b.subarray(0, 4).toString('latin1') === 'GIF8',
    size: gifSize,
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    match: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('latin1') === 'RIFF' &&
      b.subarray(8, 12).toString('latin1') === 'WEBP',
    size: webpSize,
  },
]

/** Trust the bytes, not the Content-Type header a client claims. */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf)) return null
  return IMAGE_TYPES.find((t) => t.match(buf)) || null
}

// --- dimensions ---------------------------------------------------------------

function pngSize(b) {
  // IHDR is always the first chunk: 8 magic + 4 length + 4 type, then w/h.
  if (b.length < 24) return null
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

function gifSize(b) {
  if (b.length < 10) return null
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
}

// Walk the marker segments to the start-of-frame, which is the only place a
// JPEG states its size. Progressive and arithmetic-coded variants use
// different SOF markers, hence the range rather than a check for SOF0.
function jpegSize(b) {
  let offset = 2
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset++
      continue
    }
    const marker = b[offset + 1]
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = b.readUInt16BE(offset + 2)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) }
    if (length < 2) return null
    offset += 2 + length
  }
  return null
}

// Three container flavours, each storing the size differently.
function webpSize(b) {
  const format = b.subarray(12, 16).toString('latin1')
  if (format === 'VP8 ' && b.length >= 30) {
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  }
  if (format === 'VP8L' && b.length >= 25) {
    // 14 bits each, packed little-endian across four bytes, minus one.
    const bits = b.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (format === 'VP8X' && b.length >= 30) {
    // 24-bit canvas size, minus one.
    const read24 = (at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)
    return { width: read24(24) + 1, height: read24(27) + 1 }
  }
  return null
}

/** `{width, height}` from the header, or null when it cannot be read. */
export function imageSize(buf) {
  const kind = sniffImage(buf)
  if (!kind) return null
  try {
    const size = kind.size(buf)
    if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return null
    if (size.width <= 0 || size.height <= 0) return null
    return size
  } catch {
    // A truncated or malformed header — treated as unreadable, not as an error.
    return null
  }
}

/**
 * Decide whether an upload may be stored.
 *
 * @returns {{ok:true, kind:object, size:object|null, warning:string|null}
 *          |{ok:false, status:number, error:string}}
 */
export function validateUpload(buf, { maxBytes = MAX_UPLOAD_BYTES, maxDimension = MAX_IMAGE_DIMENSION } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return { ok: false, status: 400, error: 'Empty upload' }
  }
  if (buf.length > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: `That image is ${formatBytes(buf.length)} — the limit is ${formatBytes(maxBytes)}.`,
    }
  }
  const kind = sniffImage(buf)
  if (!kind) {
    return { ok: false, status: 415, error: 'Unsupported file — use a PNG, JPG, WEBP or GIF image.' }
  }

  const size = imageSize(buf)
  if (size && (size.width > maxDimension || size.height > maxDimension)) {
    return {
      ok: false,
      status: 413,
      error: `That image is ${size.width}×${size.height}px — the limit is ${maxDimension}px on the longest side.`,
    }
  }

  return {
    ok: true,
    kind,
    size,
    warning:
      buf.length > WARN_BYTES
        ? `${formatBytes(buf.length)} is large for a card image — members on mobile data will feel it.`
        : null,
  }
}

export function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}
