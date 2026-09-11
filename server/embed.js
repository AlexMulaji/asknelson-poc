import dns from 'node:dns/promises'
import net from 'node:net'
import express from 'express'
import { baseUrl, rateLimiter } from './http.js'

// "Can this external page be shown inside the app?"
//
// Publishers decide that, not us: browsers enforce X-Frame-Options and CSP
// frame-ancestors on iframes, and no client code can override them. Worse, the
// page can't even tell a frame was refused — a blocked iframe still fires
// `load` and just shows the browser's error page. So the server fetches the
// page's headers once and answers yes/no; the in-app viewer embeds on yes and
// offers "Open in browser" on no.
//
// This endpoint makes outbound requests, so it must not become an open proxy
// or a way to probe the internal network (SSRF): only hosts the app's own
// content links to can be checked, only over https, every hop of a redirect is
// resolved and refused if it lands on a private address, and nothing from the
// response except the verdict is returned.

const TTL_MS = 12 * 60 * 60 * 1000
const MAX_CACHE = 1000
const MAX_REDIRECTS = 4
const TIMEOUT_MS = 6000
// A browser UA: several publishers answer bots with a different page (or a
// 403) whose headers wouldn't reflect what the member's browser receives.
const UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'

const cache = new Map() // url -> { at, verdict }

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, incl. cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  const v6 = ip.toLowerCase()
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7))
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')
}

async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) throw new Error('IP literals are not checked')
  const addresses = await dns.lookup(hostname, { all: true })
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Host does not resolve to a public address')
  }
}

// Does one CSP source expression permit framing by `origin` (a URL)?
function sourceAllows(source, origin) {
  const s = source.toLowerCase()
  if (s === '*') return true
  if (s === "'none'" || s === "'self'") return false // 'self' is the publisher's own origin
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return origin.protocol === s // scheme source, e.g. https:
  const m = s.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/)
  if (!m) return false
  const [, scheme, wildcard, host, port] = m
  if (scheme && `${scheme}:` !== origin.protocol) return false
  const hostOk = wildcard ? origin.hostname.endsWith(`.${host}`) : origin.hostname === host
  const defaultPort = origin.protocol === 'https:' ? '443' : '80'
  const portOk = !port || port === '*' || port === (origin.port || defaultPort)
  return hostOk && portOk
}

function frameVerdict(headers, origins) {
  // Several policies may arrive comma-joined; each is enforced, so each one
  // that sets frame-ancestors must allow us. Where frame-ancestors is present,
  // browsers ignore X-Frame-Options.
  const csp = headers.get('content-security-policy') || ''
  let cspDecides = false
  for (const policy of csp.split(',')) {
    const directive = policy
      .split(';')
      .map((d) => d.trim())
      .find((d) => /^frame-ancestors(\s|$)/i.test(d))
    if (!directive) continue
    cspDecides = true
    const sources = directive.split(/\s+/).slice(1)
    if (!origins.some((origin) => sources.some((src) => sourceAllows(src, origin)))) {
      return { embeddable: false, reason: 'frame-ancestors' }
    }
  }
  if (cspDecides) return { embeddable: true }

  const xfo = (headers.get('x-frame-options') || '').toLowerCase()
  // ALLOW-FROM is obsolete and treated as a refusal here — better to offer
  // "Open in browser" than a broken frame.
  if (/deny|sameorigin|allow-from/.test(xfo)) return { embeddable: false, reason: 'x-frame-options' }
  return { embeddable: true }
}

async function inspect(startUrl, origins) {
  let url = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // An http page can't be framed into an https app anyway (mixed content).
    if (url.protocol !== 'https:') return { embeddable: false, reason: 'insecure' }
    await assertPublicHost(url.hostname)
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    })
    res.body?.cancel().catch(() => {}) // headers are all we need
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url)
      continue
    }
    const verdict = frameVerdict(res.headers, origins)
    if (!verdict.embeddable) return verdict
    // Bot walls and dead links: a frame would show an error page.
    if (res.status >= 400) return { embeddable: false, reason: 'unavailable' }
    return verdict
  }
  return { embeddable: false, reason: 'redirects' }
}

/**
 * @param {{ allowedHosts: () => Set<string> }} options  hosts the content links to
 */
export function createEmbedRouter({ allowedHosts }) {
  const router = express.Router()
  const limiter = rateLimiter({ windowMs: 60_000, max: 60 })

  router.get('/check', limiter, async (req, res) => {
    let url
    try {
      url = new URL(String(req.query.url || ''))
    } catch {
      return res.status(400).json({ error: 'Invalid url' })
    }
    if (!allowedHosts().has(url.hostname)) {
      return res.status(403).json({ error: 'That site is not linked from AskNelson content' })
    }

    const cached = cache.get(url.href)
    if (cached && Date.now() - cached.at < TTL_MS) return res.json(cached.verdict)

    // Where the app is served from — the origin the publisher must permit.
    const origins = [...new Set([baseUrl(req), process.env.PUBLIC_BASE_URL].filter(Boolean))].map(
      (o) => new URL(o)
    )

    let verdict
    try {
      verdict = await inspect(url, origins)
    } catch (err) {
      verdict = { embeddable: false, reason: 'unreachable' }
      console.warn(`[asknelson][embed] ${url.hostname}: ${err.message}`)
    }
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value)
    cache.set(url.href, { at: Date.now(), verdict })
    res.set('Cache-Control', 'private, max-age=3600')
    res.json(verdict)
  })

  return router
}
