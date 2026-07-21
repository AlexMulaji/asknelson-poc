// Fire-and-forget click/page-view tracking, sent to POST /api/events and
// attributed server-side to the member behind the current session (see
// src/lib/authApi.js). Never throws and never blocks the caller — a failed
// or dropped tracking call must not affect navigation or UI state.
//
// Pass `{ sensitive: true }` for events that touch wellbeing content
// (assessment start/complete). The server stores those under a one-way
// pseudonymous id instead of the member id — see server/db.js.

import { getSessionId } from '../lib/authApi.js'

export function trackEvent(type, payload = {}, { sensitive = false } = {}) {
  const sessionId = getSessionId()
  if (!sessionId) return // not linked to a member yet — nothing to attribute

  const body = JSON.stringify({
    sessionId,
    type,
    path: typeof location !== 'undefined' ? location.pathname : undefined,
    payload,
    sensitive,
  })

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      const ok = navigator.sendBeacon('/api/events', blob)
      if (ok) return
    }
  } catch {
    /* fall through to fetch */
  }

  try {
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* offline, blocked, or otherwise unavailable — drop it */
  }
}
