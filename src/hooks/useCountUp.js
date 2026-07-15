import { useEffect, useRef, useState } from 'react'

// Animate a number from 0 to `target` with an ease-out curve. Respects
// prefers-reduced-motion by jumping straight to the final value.
export function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const safeTarget = typeof target === 'number' ? target : 0
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduce || duration <= 0) {
      setValue(safeTarget)
      return undefined
    }

    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setValue(Math.round(safeTarget * eased))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return value
}
