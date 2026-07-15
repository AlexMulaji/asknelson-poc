import { useCallback, useEffect, useRef, useState } from 'react'

// Audio files are added manually to /src/assets/sounds/.
// We import them so Vite fingerprints + the service worker can cache them.
// If a file is missing during dev, the import resolves to undefined and we
// simply skip playback for that sound.
const soundFiles = import.meta.glob('../assets/sounds/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})

function soundUrl(name) {
  if (!name || name === 'none') return null
  const match = Object.entries(soundFiles).find(([path]) =>
    path.toLowerCase().endsWith(`/${name}.mp3`)
  )
  return match ? match[1] : null
}

export const DURATIONS = [5, 10, 15, 20] // minutes

export const SOUNDS = [
  { id: 'none', label: 'None' },
  { id: 'rain', label: 'Rain' },
  { id: 'forest', label: 'Forest' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'bowls', label: 'Singing Bowls' },
]

/**
 * Meditation session timer with optional looping ambient sound.
 */
export function useMeditation() {
  const [durationMin, setDurationMin] = useState(5)
  const [sound, setSound] = useState('none')
  const [remaining, setRemaining] = useState(5 * 60) // seconds
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  const intervalRef = useRef(null)
  const audioRef = useRef(null)

  // Reset the clock whenever the chosen duration changes (while idle).
  useEffect(() => {
    if (!isRunning) {
      setRemaining(durationMin * 60)
      setIsComplete(false)
    }
  }, [durationMin]) // eslint-disable-line react-hooks/exhaustive-deps

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
  }, [])

  const playAudio = useCallback(() => {
    const url = soundUrl(sound)
    if (!url) return // "None" selected or file not yet added
    stopAudio()
    const audio = new Audio(url)
    audio.loop = true
    audio.volume = 0.6
    audio.play().catch(() => {
      /* autoplay can be blocked until a user gesture — safe to ignore */
    })
    audioRef.current = audio
  }, [sound, stopAudio])

  const clearTick = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const finish = useCallback(() => {
    clearTick()
    stopAudio()
    setIsRunning(false)
    setIsComplete(true)
  }, [clearTick, stopAudio])

  const start = useCallback(() => {
    if (isComplete) {
      setRemaining(durationMin * 60)
      setIsComplete(false)
    }
    setIsRunning(true)
    playAudio()
    clearTick()
    intervalRef.current = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          finish()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [isComplete, durationMin, playAudio, clearTick, finish])

  const pause = useCallback(() => {
    clearTick()
    setIsRunning(false)
    if (audioRef.current) audioRef.current.pause()
  }, [clearTick])

  const stop = useCallback(() => {
    clearTick()
    stopAudio()
    setIsRunning(false)
    setIsComplete(false)
    setRemaining(durationMin * 60)
  }, [clearTick, stopAudio, durationMin])

  const dismissComplete = useCallback(() => {
    setIsComplete(false)
    setRemaining(durationMin * 60)
  }, [durationMin])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      clearTick()
      stopAudio()
    }
  }, [clearTick, stopAudio])

  const total = durationMin * 60
  const progress = total > 0 ? (total - remaining) / total : 0

  return {
    durationMin,
    setDurationMin,
    sound,
    setSound,
    remaining,
    total,
    progress,
    isRunning,
    isComplete,
    start,
    pause,
    stop,
    dismissComplete,
  }
}
