// Generates the PWA app icons: the AskNelson speech-bubble mark (green) centred
// on a solid navy tile — matching the favicon. No image libraries: the mark is
// rasterised by hand (point-in-circle + point-in-polygon) with supersampled
// anti-aliasing, then encoded as a truecolour PNG.
//
// Run with: node scripts/gen-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const OUT_DIR = new URL('../public/icons/', import.meta.url)
mkdirSync(OUT_DIR, { recursive: true })

const NAVY = [0x17, 0x2b, 0x5c]
const GREEN = [0x8c, 0xc6, 0x3f]

// The mark, defined in the same 24x24 space as favicon.svg / NelsonMarkIcon.
const CIRCLE = { cx: 12.5, cy: 9.5, r: 8 }
const TAIL = [
  [10.8, 17],
  [19, 12.5],
  [11.3, 23.8],
  [8.7, 22.2],
]
// Bounding box of the whole mark (circle + tail) and its centre.
const BBOX = { minY: 1.5, h: 22.3, cx: 12.5, cy: 12.65 }

function inCircle(x, y) {
  const dx = x - CIRCLE.cx
  const dy = y - CIRCLE.cy
  return dx * dx + dy * dy <= CIRCLE.r * CIRCLE.r
}

function inTail(x, y) {
  let inside = false
  for (let i = 0, j = TAIL.length - 1; i < TAIL.length; j = i++) {
    const [xi, yi] = TAIL[i]
    const [xj, yj] = TAIL[j]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const inMark = (x, y) => inCircle(x, y) || inTail(x, y)

/* ── PNG encoding ──────────────────────────────────────────────────────── */
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

// `frac` = fraction of the icon height the mark occupies. Maskable icons use a
// smaller value so the mark stays inside the mask's safe zone.
function makePng(size, frac) {
  const k = (frac * size) / BBOX.h // pixels per mark-space unit
  const N = 4 // supersamples per axis for anti-aliasing

  const rowLen = size * 3
  const raw = Buffer.alloc((rowLen + 1) * size)
  for (let y = 0; y < size; y++) {
    const off = y * (rowLen + 1)
    raw[off] = 0 // filter byte
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const px = x + (sx + 0.5) / N
          const py = y + (sy + 0.5) / N
          const mx = BBOX.cx + (px - size / 2) / k
          const my = BBOX.cy + (py - size / 2) / k
          if (inMark(mx, my)) hits++
        }
      }
      const t = hits / (N * N)
      const p = off + 1 + x * 3
      raw[p] = Math.round(NAVY[0] * (1 - t) + GREEN[0] * t)
      raw[p + 1] = Math.round(NAVY[1] * (1 - t) + GREEN[1] * t)
      raw[p + 2] = Math.round(NAVY[2] * (1 - t) + GREEN[2] * t)
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour RGB
  const idat = deflateSync(raw)
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const targets = [
  ['icon-192.png', 192, 0.72],
  ['icon-512.png', 512, 0.72],
  // Maskable: extra padding so the mark stays within the safe zone when masked.
  ['icon-512-maskable.png', 512, 0.58],
]

for (const [name, size, frac] of targets) {
  writeFileSync(new URL(name, OUT_DIR), makePng(size, frac))
  console.log(`wrote public/icons/${name} (${size}x${size})`)
}
