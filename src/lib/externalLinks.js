// Helpers for showing external content inside the app.
//
// Two routes in:
//   videos    — YouTube, TED and Vimeo watch pages refuse to be framed, but
//               each provider ships an embeddable player; we rewrite to it.
//   everything else — whether it can be framed is the publisher's choice
//               (X-Frame-Options / CSP frame-ancestors). The server checks
//               once and caches the answer (/api/embed/check).

export const isExternalUrl = (raw) => /^https?:\/\//i.test(String(raw || ''))

export function hostOf(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// "90", "1m30s", "1h2m3s" -> seconds.
function startSeconds(t) {
  if (!t) return 0
  if (/^\d+$/.test(t)) return Number(t)
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : 0
}

/** The provider's embeddable player for a video URL, or null. */
export function videoEmbedUrl(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m)\./, '')

  if (host === 'youtube.com' || host === 'youtu.be') {
    let id = null
    if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0]
    else if (url.pathname === '/watch') id = url.searchParams.get('v')
    else id = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1] ?? null
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null
    const start = startSeconds(url.searchParams.get('t') || url.searchParams.get('start'))
    // youtube-nocookie sets no tracking cookies until the member presses play.
    return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${start ? `&start=${start}` : ''}`
  }

  if (host === 'ted.com') {
    const slug = url.pathname.match(/^\/talks\/([\w-]+)/)?.[1]
    if (slug) return `https://embed.ted.com/talks/${slug}`
  }

  if (host === 'vimeo.com') {
    const id = url.pathname.match(/^\/(\d+)/)?.[1]
    if (id) return `https://player.vimeo.com/video/${id}`
  }

  return null
}

const verdicts = new Map()

/**
 * { embeddable: boolean, reason?: string } for an external page. Anything
 * that isn't a clear yes — the check failing, being offline, no backend in
 * `vite dev` — comes back as a no, so the viewer offers "Open in browser"
 * rather than a broken frame.
 */
export async function checkEmbeddable(url) {
  if (verdicts.has(url)) return verdicts.get(url)
  try {
    const res = await fetch(`/api/embed/check?url=${encodeURIComponent(url)}`, {
      credentials: 'same-origin',
    })
    const verdict = res.ok ? await res.json() : { embeddable: false, reason: `check-${res.status}` }
    if (res.ok) verdicts.set(url, verdict)
    return verdict
  } catch {
    return { embeddable: false, reason: 'offline' }
  }
}
