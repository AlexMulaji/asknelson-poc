import { ShieldIcon } from './Icons.jsx'
import ConfidentialityStamp from './ConfidentialityStamp.jsx'

// The "Your Privacy Matters" reassurance band that closes every desktop screen
// in the V1 design.
export default function PrivacyBand() {
  return (
    <div className="flex items-center gap-4 rounded-card border border-brand/30 bg-brand-wash px-5 py-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-btn bg-brand-tint text-brand">
        <ShieldIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-extrabold text-navy">Your Privacy Matters</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
          We value your trust and privacy. Any information shared on the AskNelson wellness app is
          kept safe, secure, and confidential.
        </p>
      </div>
      <ConfidentialityStamp imgClassName="hidden h-12 w-auto xl:block" />
    </div>
  )
}
