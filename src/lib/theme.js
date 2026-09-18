// Light / dark theme.
//
// Three preferences, not two: "system" is the default and keeps following the
// OS after the choice is made, which is the behaviour people expect from a
// phone. "light" and "dark" pin the app regardless of the system.
//
// The class goes on <html> rather than <body> so it is in place before the
// first paint (see the boot script in index.html) and so Tailwind's `dark:`
// variant works everywhere, including portals rendered outside #root.

export const STORAGE_KEY = 'asknelson:theme'
export const PREFERENCES = ['light', 'dark', 'system']

// Matches --navy in each theme: the colour behind the status bar and the PWA
// title bar. Kept here rather than read from the stylesheet because it has to
// be written to a <meta> tag, which takes a hex, not a token.
const THEME_COLOR = { light: '#01243B', dark: '#0D1D28' }

const query = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

/** The OS setting, or 'light' where it can't be read. */
export const systemTheme = () => (query()?.matches ? 'dark' : 'light')

/** The stored preference, defaulting to 'system'. */
export function readPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return PREFERENCES.includes(stored) ? stored : 'system'
  } catch {
    // Private mode, or storage blocked entirely. Following the system is a
    // safe answer: it is the default anyway.
    return 'system'
  }
}

export function writePreference(preference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Not being able to remember the choice is not a reason to refuse it --
    // the theme still applies for this session.
  }
}

/** Which theme a preference actually resolves to right now. */
export const resolveTheme = (preference) =>
  preference === 'system' ? systemTheme() : preference

/** Put a resolved theme ('light' | 'dark') on the document. */
export function applyTheme(theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  // Tells the browser to render form controls, scrollbars and the like in the
  // matching theme. Without it, a dark page keeps white scrollbars.
  root.style.colorScheme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLOR[theme] ?? THEME_COLOR.light)
}

/**
 * Call `fn` whenever the OS theme changes. Returns an unsubscribe.
 *
 * Safari below 14 has no addEventListener on MediaQueryList, hence the
 * addListener fallback -- iOS is most of this app's traffic.
 */
export function watchSystemTheme(fn) {
  const mq = query()
  if (!mq) return () => {}
  const handler = () => fn(systemTheme())
  if (mq.addEventListener) {
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }
  mq.addListener(handler)
  return () => mq.removeListener(handler)
}
