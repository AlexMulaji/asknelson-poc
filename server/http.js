// Small request helpers shared by the routers.

export function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

// `trust proxy` is set in index.js, so req.secure reflects X-Forwarded-Proto
// from the load balancer; the header check covers proxies it doesn't trust.
export function isSecure(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https'
}

export function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
  const proto = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol
  return `${proto}://${req.get('host')}`
}

export function str(value, max = 1024) {
  if (value == null) return null
  const s = String(value).trim()
  return s ? s.slice(0, max) : null
}

/**
 * Fixed-window limiter, in memory, per `key` (IP by default). Enough to stop a
 * retry storm, credential stuffing from one address, or SMS bombing of one
 * number; not a defence against a distributed flood — put a real proxy in
 * front for that. Per-process: with several replicas each keeps its own count.
 */
export function rateLimiter({ windowMs, max, key = (req) => req.ip, message = 'Too many requests' }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const k = key(req) || 'unknown'
    const entry = hits.get(k)
    if (!entry || now > entry.resetAt) hits.set(k, { count: 1, resetAt: now + windowMs })
    else if (++entry.count > max) return res.status(429).json({ error: message })
    // Opportunistic cleanup so the map cannot grow without bound.
    if (hits.size > 5000) for (const [kk, v] of hits) if (now > v.resetAt) hits.delete(kk)
    next()
  }
}

/** Responses carrying personal data must never land in a proxy or SW cache. */
export function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store')
  next()
}
