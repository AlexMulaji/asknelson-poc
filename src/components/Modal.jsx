import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// The centred dialog card shared by Get Help and the confirm prompts.
//
// Closes on Escape and on a tap on the backdrop (not the card). Focus moves to
// the element marked `data-autofocus` -- or the card itself -- on open, and is
// handed back to whatever had it on close, so keyboard users land where they
// started.
//
// Portalled to <body> for the same reason as MeditationPlayer: the page
// wrapper keeps a `transform` from .page-enter, which would otherwise become
// the containing block for this fixed overlay.
export default function Modal({ open, onClose, labelledBy, children }) {
  const cardRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement
    const target = cardRef.current?.querySelector('[data-autofocus]') || cardRef.current
    target?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-navy/60 p-6 animate-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="w-full max-w-[342px] rounded-btn border border-line bg-surface px-6 pb-7 pt-8 text-center shadow-lift outline-none lg:max-w-[464px] lg:px-12 lg:pb-10 lg:pt-9"
      >
        {children}
      </div>
    </div>,
    document.body
  )
}

// Button styles shared by every dialog; stacked full-width.
export const modalBtn = {
  base: 'flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-[6px] px-6 text-[17px] font-bold transition active:scale-[0.99]',
  danger: 'bg-danger text-white hover:brightness-95',
  brand: 'bg-brand text-on-brand hover:bg-brand-dark',
  outline: 'border border-slate-300 bg-surface text-ink-faint hover:border-ink-soft hover:text-ink-soft',
}
