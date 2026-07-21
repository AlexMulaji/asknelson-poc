import logoUrl from '../assets/logo-asknelson.png'
import ConfidentialityStamp from './ConfidentialityStamp.jsx'

// Shown instead of the app when the device has no valid member session: no
// `?t=<token>` on the URL and nothing already linked in localStorage. This is
// a confidential EAP app, so we don't fall back to anonymous access — the
// only way in is the personal WhatsApp link. See App.jsx for the check.
export default function LinkGate() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 text-center">
      <img src={logoUrl} alt="AskNelson" className="h-12 w-auto" />

      <h1 className="mt-6 font-display text-[22px] font-bold text-black">
        Open AskNelson from your WhatsApp link
      </h1>
      <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-gray-500">
        This app is personal to you. Please use the link sent to you on WhatsApp to get in — it
        only needs to be tapped once.
      </p>

      <p className="mt-6 text-[12px] leading-relaxed text-gray-400">
        Lost your link, or think it's stopped working? Reach out to your EAP contact and they'll
        send you a new one.
      </p>

      <ConfidentialityStamp className="mt-10" imgClassName="max-w-[150px] opacity-90" />
    </div>
  )
}
