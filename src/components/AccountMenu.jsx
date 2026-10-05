import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import AccountPanel from './AccountPanel.jsx'
import { DotsVerticalIcon } from './Icons.jsx'

// The ⋮ on the mobile Home hero: opens the appearance / account / Logout panel
// that desktop shows at the foot of the sidebar.
//
// The popover is portalled to <body> and positioned from the button's on-screen
// rect. Rendering it in place doesn't work: the hero clips its overflow, and
// the page wrapper's .page-enter transform would trap a fixed backdrop inside
// the page instead of covering the screen.
export default function AccountMenu() {
  const [anchor, setAnchor] = useState(null) // the button's rect while open
  const buttonRef = useRef(null)
  const close = useCallback(() => setAnchor(null), [])

  useEffect(() => {
    if (!anchor) return
    const onKey = (e) => {
      if (e.key === 'Escape') close()
    }
    // The popover is pinned to where the button was; if the layout moves,
    // close rather than leave it floating somewhere else.
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, { passive: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close)
    }
  }, [anchor, close])

  const toggle = () => {
    if (anchor) return close()
    setAnchor(buttonRef.current?.getBoundingClientRect() ?? null)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="Account and appearance"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        className="grid h-10 w-10 place-items-center rounded-full text-white transition hover:bg-white/15"
      >
        <DotsVerticalIcon className="h-7 w-7" />
      </button>

      {anchor
        ? createPortal(
            <>
              <div aria-hidden className="fixed inset-0 z-[44] bg-navy/10 animate-fade" onClick={close} />
              <div
                role="dialog"
                aria-label="Account and appearance"
                className="fixed z-[45] w-[244px] rounded-[8px] border border-line bg-surface px-[15px] py-5 shadow-lift animate-fade"
                style={{
                  top: anchor.bottom + 8,
                  right: Math.max(16, window.innerWidth - anchor.right),
                }}
              >
                <AccountPanel compact onSignedOut={close} />
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}
