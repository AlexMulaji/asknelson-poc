import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import Modal, { modalBtn } from './Modal.jsx'
import { AlertIcon, CallIcon } from './Icons.jsx'
import { flushNow, track } from '../lib/analytics.js'

// "Get Help Now": the urgent-support prompt that replaced the AskNelson page.
//
// It is a dialog rather than a route so it can be raised from anywhere -- the
// tab bar, the sidebar, a Home tile, an assessment result, even the signed-out
// auth screens -- without the member losing their place. Any component calls
// `useGetHelp()` to get `openHelp`; the provider (mounted once in main.jsx)
// owns the open state and renders the dialog.

// `tel:` needs the digits unspaced; the spaced form is what we show.
export const HELPLINE = '0800 635 766'
export const HELPLINE_TEL = 'tel:0800635766'

const GetHelpContext = createContext({ openHelp: () => {} })

export function GetHelpProvider({ children }) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState(null)

  // `from` says which surface raised it, for the EAP team's reporting.
  const openHelp = useCallback((from = 'unknown') => {
    setSource(typeof from === 'string' ? from : 'unknown')
    setOpen(true)
    track('help_opened', { source: typeof from === 'string' ? from : 'unknown' })
  }, [])
  const close = useCallback(() => setOpen(false), [])

  const value = useMemo(() => ({ openHelp }), [openHelp])

  return (
    <GetHelpContext.Provider value={value}>
      {children}
      <Modal open={open} onClose={close} labelledBy="get-help-title">
        <div className="flex justify-center text-danger">
          <AlertIcon className="h-[72px] w-[72px] lg:h-20 lg:w-20" />
        </div>
        <h2
          id="get-help-title"
          className="mt-4 font-display text-[32px] font-extrabold leading-tight text-ink lg:text-[38px]"
        >
          Get Help Now
        </h2>
        <p className="mx-auto mt-2.5 max-w-[320px] text-[14px] font-light leading-relaxed text-ink-soft lg:text-[16px]">
          Do you need trusted support from a qualified professional?
        </p>
        <div className="mt-7 space-y-3">
          <a
            href={HELPLINE_TEL}
            data-autofocus
            // Urgent-help taps are the signal the EAP team most needs to see,
            // so flush immediately rather than waiting for the next batch.
            onClick={() => {
              track('sos_pressed', { destination: HELPLINE_TEL, source })
              flushNow()
            }}
            className={`${modalBtn.base} ${modalBtn.danger}`}
          >
            <CallIcon className="h-[22px] w-[22px] shrink-0" />
            <span className="flex flex-col items-start leading-tight">
              <span>Get Help Now</span>
              <span className="text-[13px] font-semibold text-white/85">{HELPLINE}</span>
            </span>
          </a>
          <button type="button" onClick={close} className={`${modalBtn.base} ${modalBtn.outline}`}>
            Cancel
          </button>
        </div>
      </Modal>
    </GetHelpContext.Provider>
  )
}

export const useGetHelp = () => useContext(GetHelpContext)
