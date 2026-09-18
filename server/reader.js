import crypto from 'node:crypto'
import express from 'express'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import sharp from 'sharp'
import { UA, assertPublicHost } from './embed.js'
import { rateLimiter } from './http.js'
import { sniffImage } from './images.js'

// Reader view: "show this article inside the app" for publishers that refuse
// to be framed.
//
// The server fetches the page, Mozilla's Readability (the engine behind
// Firefox's Reader View) pulls out the article, and what comes back is reduced
// to a short allowlist of plain text-and-image markup before it ever leaves
// here. The client sanitises it again before rendering — this HTML is shown on
// the app's own origin, so it gets two independent passes.
//
// Outbound requests follow the same rules as the embed check (embed.js): only
// hosts the app's content links to, https only, every redirect hop resolved
// and refused if it lands on a private address. Responses are size-capped and
// cached, so one article is fetched once, not once per member.
//
// Images are not linked to directly: each one goes through /image, which
// shrinks it to a phone-sized WebP (see resizeForMobile). That keeps an
// article light on mobile data, and the publisher's image host never sees the
// member's IP address.

const TTL_MS = 6 * 60 * 60 * 1000
const FAILURE_TTL_MS = 30 * 60 * 1000
const MAX_CACHE = 300
const MAX_REDIRECTS = 4
const TIMEOUT_MS = 8000
const MAX_BYTES = 3 * 1024 * 1024
// Below this the "article" is a teaser, a cookie wall or a paywall stub, and
// the original page is the better experience.
const MIN_TEXT_CHARS = 600
const WORDS_PER_MINUTE = 220

// --- sanitising -----------------------------------------------------------------

// Kept, with their text.
const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'q', 'cite', 'abbr', 'time',
  'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
  'a', 'img', 'figure', 'figcaption',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
])

// Removed along with everything inside them: active content, embeds that would
// load third-party code, and form controls.
const DROPPED_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'frame', 'frameset',
  'object', 'embed', 'applet', 'form', 'input', 'button', 'select', 'option',
  'textarea', 'svg', 'math', 'link', 'meta', 'base', 'head', 'title',
  'video', 'audio', 'source', 'track', 'canvas', 'dialog', 'portal',
])

// Everything else (div, span, section, font, custom elements…) is unwrapped:
// the tag goes, its children stay.

function absoluteUrl(value, base, protocols) {
  if (!value) return null
  try {
    const url = new URL(String(value).trim(), base)
    return protocols.includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

// Lazy-loading sites put a placeholder in src and the real image elsewhere.
function imageSource(el, base) {
  const srcset = el.getAttribute('srcset') || el.getAttribute('data-srcset') || ''
  const candidates = [
    el.getAttribute('src'),
    el.getAttribute('data-src'),
    el.getAttribute('data-original'),
    el.getAttribute('data-lazy-src'),
    srcset.split(',')[0]?.trim().split(/\s+/)[0],
  ]
  for (const candidate of candidates) {
    // https only: an http image is mixed content on an https app.
    const url = absoluteUrl(candidate, base, ['https:'])
    if (url) return url
  }
  return null
}

function cleanAttributes(el, tag, base, options) {
  const keep = {}
  if (tag === 'a') {
    const href = absoluteUrl(el.getAttribute('href'), base, ['https:', 'http:', 'mailto:'])
    if (href) keep.href = href
  } else if (tag === 'img') {
    const src = imageSource(el, base)
    // Articles are read on phones: images go through the resizing proxy
    // rather than straight to the publisher's full-size original.
    keep.src = src && options.imageSrc ? options.imageSrc(src) : src
    const alt = el.getAttribute('alt')
    if (alt) keep.alt = alt.slice(0, 300)
  } else if (tag === 'td' || tag === 'th') {
    for (const name of ['colspan', 'rowspan']) {
      const n = Number(el.getAttribute(name))
      if (Number.isInteger(n) && n > 1 && n <= 50) keep[name] = String(n)
    }
  } else if (tag === 'abbr') {
    const title = el.getAttribute('title')
    if (title) keep.title = title.slice(0, 200)
  } else if (tag === 'time') {
    const datetime = el.getAttribute('datetime')
    if (datetime) keep.datetime = datetime.slice(0, 64)
  }

  for (const name of [...el.attributes].map((a) => a.name)) el.removeAttribute(name)
  for (const [name, value] of Object.entries(keep)) {
    if (value != null) el.setAttribute(name, value)
  }
}

function sanitiseNode(node, base, options) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 8) {
      child.remove() // comments
      continue
    }
    if (child.nodeType !== 1) continue // text stays as text

    const tag = child.tagName.toLowerCase()
    if (DROPPED_TAGS.has(tag)) {
      child.remove()
      continue
    }

    // Recurse first, so an unwrapped element's children are already clean.
    sanitiseNode(child, base, options)

    // The page title is shown by the viewer; a second h1 in the body would
    // compete with it.
    if (tag === 'h1') {
      const h2 = child.ownerDocument.createElement('h2')
      while (child.firstChild) h2.appendChild(child.firstChild)
      child.replaceWith(h2)
      continue
    }

    if (!ALLOWED_TAGS.has(tag)) {
      child.replaceWith(...child.childNodes)
      continue
    }

    cleanAttributes(child, tag, base, options)
    if (tag === 'img' && !child.getAttribute('src')) child.remove()
  }
}

/**
 * Reduce article HTML to the reader allowlist: plain structural tags, https
 * images, and links with a safe scheme — every other tag unwrapped or dropped,
 * every other attribute removed. Relative URLs resolve against `baseUrl`.
 * options.imageSrc(absoluteUrl) rewrites each image's src (the resizing proxy).
 */
export function sanitiseArticleHtml(html, baseUrl, options = {}) {
  const { document } = parseHTML(`<!doctype html><html><body>${html ?? ''}</body></html>`)
  sanitiseNode(document.body, baseUrl, options)
  return document.body.innerHTML.trim()
}

// --- extraction -------------------------------------------------------------------

const plain = (value, max) => {
  if (value == null) return null
  const s = String(value).replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}

/**
 * Pull the readable article out of a page's HTML.
 * @returns {{readable:true, title, byline, siteName, excerpt, lang, dir, publishedTime, minutes, content}
 *          | {readable:false, reason:string}}
 */
export function extractArticle(html, pageUrl, options = {}) {
  const { document } = parseHTML(html)
  let article
  try {
    article = new Readability(document, { charThreshold: MIN_TEXT_CHARS }).parse()
  } catch {
    return { readable: false, reason: 'unparseable' }
  }
  const text = article?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  if (!article || text.length < MIN_TEXT_CHARS) return { readable: false, reason: 'no-article' }

  const content = sanitiseArticleHtml(article.content, pageUrl, options)
  if (!content) return { readable: false, reason: 'no-article' }

  const words = text.split(' ').length
  return {
    readable: true,
    title: plain(article.title, 300),
    byline: plain(article.byline, 200),
    siteName: plain(article.siteName, 120),
    excerpt: plain(article.excerpt, 500),
    lang: plain(article.lang, 16),
    dir: article.dir === 'rtl' ? 'rtl' : 'ltr',
    publishedTime: plain(article.publishedTime, 64),
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    content,
  }
}

// --- fetching ---------------------------------------------------------------------

function charsetOf(contentType, head) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '')?.[1]
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1]
  const label = (fromHeader || fromMeta || 'utf-8').toLowerCase()
  try {
    return new TextDecoder(label)
  } catch {
    return new TextDecoder('utf-8')
  }
}

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      reader.cancel().catch(() => {})
      throw new Error('response too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/**
 * GET a URL under the SSRF rules: https only, every redirect hop resolved and
 * refused if it lands on a private address, body size-capped.
 * Returns { bytes, type, url } or { reason }.
 */
async function fetchPublic(startUrl, { accept, acceptType, maxBytes }) {
  let url = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:') return { reason: 'insecure' }
    await assertPublicHost(url.hostname)
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': UA, accept },
    })
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      res.body?.cancel().catch(() => {})
      url = new URL(location, url)
      continue
    }
    const type = res.headers.get('content-type') || ''
    if (res.status >= 400 || !acceptType.test(type)) {
      res.body?.cancel().catch(() => {})
      return { reason: res.status >= 400 ? 'unavailable' : 'wrong-type' }
    }
    return { bytes: await readCapped(res, maxBytes), type, url }
  }
  return { reason: 'redirects' }
}

/** A page's HTML. Returns { html, url } or { reason }. */
async function fetchPage(url) {
  const page = await fetchPublic(url, {
    accept: 'text/html,application/xhtml+xml',
    acceptType: /html/i,
    maxBytes: MAX_BYTES,
  })
  if (!page.bytes) return { reason: page.reason === 'wrong-type' ? 'not-html' : page.reason }
  const decoder = charsetOf(page.type, page.bytes.subarray(0, 2048).toString('latin1'))
  return { html: decoder.decode(page.bytes), url: page.url }
}

/** An image's bytes. Returns { bytes } or { reason }. */
async function fetchImage(url) {
  // The type header is not trusted (the bytes are sniffed before decoding),
  // but an HTML page or a JSON error is refused before it is downloaded.
  return fetchPublic(url, {
    accept: 'image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5',
    acceptType: /^(image\/|application\/octet-stream|binary\/octet-stream|$)/i,
    maxBytes: MAX_IMAGE_BYTES,
  })
}

// --- images -----------------------------------------------------------------------

// Article images are shrunk for phones: a publisher's 2400px hero becomes a
// small WebP. The widths are a fixed set so the cache stays small and a
// caller cannot ask for arbitrary sizes; the client picks one via srcset.
export const IMAGE_WIDTHS = [480, 800, 1200]
export const DEFAULT_IMAGE_WIDTH = 800
const IMAGE_QUALITY = 68
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
// Refuses decompression bombs: a tiny file that decodes to gigapixels.
const MAX_INPUT_PIXELS = 40_000_000
const IMAGE_CACHE_BYTES = 64 * 1024 * 1024
const IMAGE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_CONCURRENT_RESIZES = 3

// Image URLs are signed so the proxy only serves images that appeared in an
// article this server extracted - it cannot be pointed at arbitrary URLs.
// READER_IMAGE_SECRET keeps signatures valid across restarts and replicas;
// without it a per-process key is used, which is fine for a single instance
// (articles are re-extracted after a restart anyway).
const IMAGE_SECRET = process.env.READER_IMAGE_SECRET || crypto.randomBytes(32).toString('hex')

export function signImageUrl(url, secret = IMAGE_SECRET) {
  return crypto.createHmac('sha256', secret).update(url).digest('base64url').slice(0, 32)
}

function validSignature(url, signature, secret) {
  const expected = Buffer.from(signImageUrl(url, secret))
  const given = Buffer.from(String(signature || ''))
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

/** The proxied, resized path for an image URL found in an article. */
export function proxiedImageSrc(url, { basePath = '/api/reader', secret = IMAGE_SECRET } = {}) {
  const params = new URLSearchParams({
    u: url,
    w: String(DEFAULT_IMAGE_WIDTH),
    s: signImageUrl(url, secret),
  })
  return `${basePath}/image?${params}`
}

// sharp is CPU-heavy; a page with 100 images must not pin every core.
let activeResizes = 0
const resizeQueue = []
async function withResizeSlot(fn) {
  if (activeResizes >= MAX_CONCURRENT_RESIZES) {
    await new Promise((resolve) => resizeQueue.push(resolve))
  }
  activeResizes++
  try {
    return await fn()
  } finally {
    activeResizes--
    resizeQueue.shift()?.()
  }
}

/**
 * Resize an image for a phone: at most `width` px wide (never enlarged),
 * EXIF-rotated, metadata stripped, re-encoded as WebP. Only the raster formats
 * the upload checks accept are decoded - no SVG, which can carry script.
 */
export async function resizeForMobile(bytes, width = DEFAULT_IMAGE_WIDTH) {
  if (!sniffImage(bytes)) throw Object.assign(new Error('unsupported image'), { status: 415 })
  return withResizeSlot(() =>
    sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: IMAGE_QUALITY, effort: 4 })
      .toBuffer()
  )
}

// --- router -----------------------------------------------------------------------

/**
 * @param {{ allowedHosts: () => Set<string>, fetchPage?: Function, fetchImage?: Function,
 *           basePath?: string, imageSecret?: string }} options
 *        allowedHosts: hosts the content links to. fetchPage/fetchImage are
 *        replaceable so the routes can be tested without the network.
 */
export function createReaderRouter({
  allowedHosts,
  fetchPage: fetchPageImpl = fetchPage,
  fetchImage: fetchImageImpl = fetchImage,
  basePath = '/api/reader',
  imageSecret = IMAGE_SECRET,
}) {
  const router = express.Router()
  // Matches the embed check: hover prefetching asks for both.
  const limiter = rateLimiter({ windowMs: 60_000, max: 60 })
  // One article can carry dozens of images; they load lazily, but a long
  // read still needs far more requests than the article limit allows.
  const imageLimiter = rateLimiter({ windowMs: 60_000, max: 400 })
  const cache = new Map() // url -> { at, ttl, body }
  const inFlight = new Map() // url -> promise, so two members opening one article share a fetch
  const images = new Map() // `${url}|${width}` -> { at, buf }
  const imagesInFlight = new Map()
  let imageBytes = 0

  const imageSrc = (url) => proxiedImageSrc(url, { basePath, secret: imageSecret })

  async function load(url) {
    try {
      const page = await fetchPageImpl(url)
      if (!page.html) return { readable: false, reason: page.reason }
      const article = extractArticle(page.html, page.url.href, { imageSrc })
      return article.readable ? { ...article, url: page.url.href } : article
    } catch (err) {
      console.warn(`[asknelson][reader] ${url.hostname}: ${err.message}`)
      return { readable: false, reason: 'unreachable' }
    }
  }

  router.get('/', limiter, async (req, res) => {
    let url
    try {
      url = new URL(String(req.query.url || ''))
    } catch {
      return res.status(400).json({ error: 'Invalid url' })
    }
    if (!allowedHosts().has(url.hostname)) {
      return res.status(403).json({ error: 'That site is not linked from AskNelson content' })
    }

    const key = url.href
    const cached = cache.get(key)
    let body
    if (cached && Date.now() - cached.at < cached.ttl) {
      body = cached.body
    } else {
      if (!inFlight.has(key)) {
        inFlight.set(
          key,
          load(url).finally(() => inFlight.delete(key))
        )
      }
      body = await inFlight.get(key)
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value)
      cache.set(key, { at: Date.now(), ttl: body.readable ? TTL_MS : FAILURE_TTL_MS, body })
    }

    // Short: the server cache is what saves the refetch, and a long browser
    // cache could outlive the image signatures when the key changes on restart.
    res.set('Cache-Control', 'private, max-age=300')
    res.json(body)
  })

  function rememberImage(key, buf) {
    // Oldest out first until the new one fits.
    while (imageBytes + buf.length > IMAGE_CACHE_BYTES && images.size) {
      const [oldKey, old] = images.entries().next().value
      images.delete(oldKey)
      imageBytes -= old.buf.length
    }
    images.set(key, { at: Date.now(), buf })
    imageBytes += buf.length
  }

  async function loadImage(url, width) {
    const fetched = await fetchImageImpl(url)
    if (!fetched.bytes) throw Object.assign(new Error(fetched.reason), { status: 502 })
    return resizeForMobile(fetched.bytes, width)
  }

  router.get('/image', imageLimiter, async (req, res) => {
    const raw = String(req.query.u || '')
    if (!validSignature(raw, req.query.s, imageSecret)) {
      return res.status(403).json({ error: 'Invalid image signature' })
    }
    let url
    try {
      url = new URL(raw)
    } catch {
      return res.status(400).json({ error: 'Invalid url' })
    }
    const width = Number(req.query.w)
    if (!IMAGE_WIDTHS.includes(width)) return res.status(400).json({ error: 'Unsupported width' })

    const key = `${url.href}|${width}`
    try {
      let entry = images.get(key)
      if (!entry || Date.now() - entry.at > IMAGE_TTL_MS) {
        if (!imagesInFlight.has(key)) {
          imagesInFlight.set(
            key,
            loadImage(url, width).finally(() => imagesInFlight.delete(key))
          )
        }
        const buf = await imagesInFlight.get(key)
        if (images.has(key)) {
          imageBytes -= images.get(key).buf.length
          images.delete(key)
        }
        rememberImage(key, buf)
        entry = images.get(key)
      }
      res.set('Content-Type', 'image/webp')
      // The URL is signed and the width fixed, so its bytes never change.
      res.set('Cache-Control', 'public, max-age=604800, immutable')
      res.send(entry.buf)
    } catch (err) {
      if (!err.status) console.warn(`[asknelson][reader] image ${url.hostname}: ${err.message}`)
      res.status(err.status || 502).json({ error: 'Image unavailable' })
    }
  })

  return router
}
