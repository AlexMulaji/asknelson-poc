import ThemeToggle from './ThemeToggle.jsx'
import { useAuth } from '../hooks/useAuth.jsx'
import { accountKind, displayName, initials } from '../lib/accountName.js'

// Appearance + who's signed in + Logout. The same block appears in two places,
// as it does in the design: the card at the foot of the desktop sidebar, and
// the popover behind the ⋮ on the mobile Home hero (AccountMenu).
//
// The name is the account's generated handle ("CalmRiver4821"), never the
// mobile number -- see lib/accountName.js for why.
export default function AccountPanel({ compact = false, onSignedOut }) {
  const { user, status, unavailable, signOut } = useAuth()
  if (status === 'loading' || unavailable || !user) return null

  return (
    <div>
      <ThemeToggle />

      <div className="mt-5 flex items-center gap-3">
        <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-brand text-[19px] font-bold text-navy">
          {initials(user)}
        </span>
        <span className="min-w-0">
          <span className="block break-all font-display text-[19px] font-extrabold leading-tight text-ink lg:text-[21px]">
            {displayName(user)}
          </span>
          <span className="block text-[14px] text-ink">{accountKind(user)}</span>
        </span>
      </div>

      <button
        type="button"
        onClick={async () => {
          await signOut()
          onSignedOut?.()
        }}
        className={[
          'mt-4 flex w-full items-center justify-center rounded-[6px] border border-slate-300 bg-surface',
          'text-[16px] font-bold text-ink-faint transition hover:border-ink-soft hover:text-ink-soft',
          compact ? 'min-h-[38px]' : 'min-h-[46px]',
        ].join(' ')}
      >
        Logout
      </button>
    </div>
  )
}
