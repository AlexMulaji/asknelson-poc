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

export function useContent(key) {
  const [data, setData] = useState(() => cache.get(key) ?? fallbacks[key])

  useEffect(() => {
    let alive = true
    fetch(`/api/content/${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((fresh) => {
        cache.set(key, fresh)
        if (alive) setData(fresh)
      })
      .catch(() => {
        // No backend / offline — stay on the bundled or cached copy.
      })
    return () => {
      alive = false
    }
  }, [key])

  return data
}
