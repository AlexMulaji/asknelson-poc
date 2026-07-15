// NotificationService — scaffold only.
//
// This wires up the browser Notification permission flow and exposes a
// scheduleNotification() helper. The actual scheduling/delivery is left as a
// TODO for a future OneSignal integration.

const PREF_KEY = 'asknelson.notifications.preference'

/**
 * Read the stored notification preference.
 * @returns {'granted' | 'denied' | 'default' | null}
 */
export function getNotificationPreference() {
  try {
    return localStorage.getItem(PREF_KEY)
  } catch {
    return null
  }
}

function storePreference(value) {
  try {
    localStorage.setItem(PREF_KEY, value)
  } catch {
    /* localStorage unavailable — ignore. */
  }
}

/**
 * Ask the browser for notification permission and persist the result.
 * Safe to call when the Notification API is missing (older browsers / iOS).
 * @returns {Promise<'granted' | 'denied' | 'default' | 'unsupported'>}
 */
export async function requestNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }

  // Already decided — don't nag the user again.
  if (Notification.permission !== 'default') {
    storePreference(Notification.permission)
    return Notification.permission
  }

  try {
    const result = await Notification.requestPermission()
    storePreference(result)
    return result
  } catch {
    return 'default'
  }
}

/**
 * Schedule a notification to fire after a delay.
 *
 * TODO: Replace this stub with OneSignal scheduling once integrated.
 * OneSignal will own delivery so notifications work even when the app/tab is
 * closed. For now this only fires while the tab is open, via setTimeout.
 *
 * @param {string} title
 * @param {string} body
 * @param {number} delayMs
 * @returns {number | null} timeout id (or null if notifications unavailable)
 */
export function scheduleNotification(title, body, delayMs) {
  // TODO(OneSignal): hand off to OneSignal REST API / SDK for real scheduling.
  //   e.g. OneSignal.sendSelfNotification(title, body, url, icon, data, buttons, delayMs)
  //   This local setTimeout fallback only works while the page is open.
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return null
  }
  if (Notification.permission !== 'granted') {
    return null
  }

  return window.setTimeout(() => {
    try {
      new Notification(title, { body, icon: '/icons/icon-192.png' })
    } catch {
      /* Notification construction can throw on some platforms — ignore. */
    }
  }, delayMs)
}
