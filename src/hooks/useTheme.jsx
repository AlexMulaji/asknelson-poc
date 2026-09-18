import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  applyTheme,
  readPreference,
  resolveTheme,
  watchSystemTheme,
  writePreference,
} from '../lib/theme.js'

// The theme the app is currently showing, and the control to change it.
//
//   preference  what the member chose: 'light' | 'dark' | 'system'
//   theme       what that resolves to right now: 'light' | 'dark'
//
// The document class is set before React mounts (the boot script in
// index.html), so this provider's job is to keep it in step afterwards, not to
// apply it for the first time.

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(readPreference)
  const [theme, setTheme] = useState(() => resolveTheme(readPreference()))

  // Re-apply whenever the choice changes, and follow the OS while the choice
  // is 'system'. The watcher is registered for every preference so that going
  // back to 'system' picks up a change made while the app was pinned.
  useEffect(() => {
    const next = resolveTheme(preference)
    setTheme(next)
    applyTheme(next)
    return watchSystemTheme((system) => {
      if (preference !== 'system') return
      setTheme(system)
      applyTheme(system)
    })
  }, [preference])

  const setPreference = useCallback((next) => {
    setPreferenceState(next)
    writePreference(next)
  }, [])

  const value = useMemo(
    () => ({
      preference,
      theme,
      setPreference,
      // Flips to the opposite of what is on screen. A member on 'system' who
      // taps this is choosing the other theme explicitly, so the preference
      // becomes pinned rather than staying on 'system'.
      toggle: () => setPreference(theme === 'dark' ? 'light' : 'dark'),
    }),
    [preference, theme, setPreference]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside a ThemeProvider')
  return value
}
