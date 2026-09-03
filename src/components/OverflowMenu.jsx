import { useEffect, useRef, useState } from 'react'
import { DotsVerticalIcon } from './Icons.jsx'

// The "⋮" menu used on Home (Settings / Logout) and My Wellness (Change /
// Restart journey). Closes on outside click, Escape, or after an item runs.
export default function OverflowMenu({ items, tone = 'navy', label = 'More options' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className={[
          'grid h-10 w-10 place-items-center rounded-full transition',
          tone === 'white' ? 'text-white hover:bg-white/15' : 'text-navy hover:bg-canvas',
        ].join(' ')}
      >
        <DotsVerticalIcon className="h-5 w-5" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-card bg-white py-1.5 shadow-lift ring-1 ring-black/5"
        >
          {items.map(({ label: itemLabel, Icon, onSelect, danger }) => (
            <button
              key={itemLabel}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSelect?.()
              }}
              className={[
                'flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-bold transition',
                danger ? 'text-danger hover:bg-pill-red' : 'text-navy hover:bg-canvas',
              ].join(' ')}
            >
              {Icon ? <Icon className="h-5 w-5 shrink-0 text-brand" /> : null}
              {itemLabel}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
