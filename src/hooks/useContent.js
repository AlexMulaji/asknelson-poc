import { useEffect, useState } from 'react'
import exploreFallback from '../data/explore.json'
import journeysFallback from '../data/journeys.json'
import assessmentsFallback from '../data/assessments.json'
import { filterPublishedDoc } from '../lib/publishRef.js'

// Bundled JSON keeps the app fully usable offline or without a backend
// (plain `vite dev`); the server copy — editable from /admin — wins when
// it can be fetched.
//
// The bundled copy is filtered the same way the server filters its own:
// without that, an item unpublished from the admin portal would still appear
// offline, or on the very first paint before the fetch lands. (The server's
// responses arrive already filtered, so nothing is filtered twice.)
const fallbacks = {
  explore: filterPublishedDoc('explore', exploreFallback),
  journeys: filterPublishedDoc('journeys', journeysFallback),
  assessments: filterPublishedDoc('assessments', assessmentsFallback),
}

// Module-level cache so tab switches don't flash fallback content while the
// fetch is in flight.
const cache = new Map()

// A server that accepts the connection but never answers would otherwise
// leave a waiting page on its loading state forever. Offline fails fast on
// its own; this only bounds the slow/hung case.
const FETCH_TIMEOUT_MS = 6000

// Server-first variant: on a first visit (nothing cached) `data` is null and
// `loading` is true until the server answers, and the bundled copy is used
// only if the fetch fails or times out. Pages whose images swap between the
// bundled and server copies (Explore) use this so the first paint never shows
// a stale bundled image that the server copy then replaces in place.
export function useContentState(key) {
  const [state, setState] = useState(() => {
    const cached = cache.get(key)
    return cached ? { data: cached, loading: false } : { data: null, loading: true }
  })

  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    fetch(`/api/content/${key}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((fresh) => {
        cache.set(key, fresh)
        if (alive) setState({ data: fresh, loading: false })
      })
      .catch(() => {
        // No backend / offline / timed out — keep the cached copy if we had
        // one, otherwise fall back to the bundled copy.
        if (alive) setState((s) => ({ data: s.data ?? fallbacks[key], loading: false }))
      })
      .finally(() => clearTimeout(timer))

    // Deliberately not aborting on unmount: a response that lands after the
    // user has navigated away still warms the cache for their next visit.
    return () => {
      alive = false
    }
  }, [key])

  return state
}

// Fallback-first: returns the bundled (or cached) copy immediately and swaps
// to the server copy when it lands. Never null, which the journey and
// assessment pages rely on.
export function useContent(key) {
  const { data } = useContentState(key)
  return data ?? fallbacks[key]
}
