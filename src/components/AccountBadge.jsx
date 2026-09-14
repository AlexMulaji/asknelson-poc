import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'

// The account affordance: the signed-in member's chip, with a sign-out control.
//
// Signing out drops them back at /login, since the app now requires an account.
// It renders nothing while the session is still resolving, or when the server
// has no database and so cannot offer accounts.

function initials(user) {
  if (user.isAnonymous) return user.username?.slice(0, 2).toUpperCase() || 'AN'
  const first = user.firstName?.[0] ?? ''
  const last = user.lastName?.[0] ?? ''
  if (first || last) return (first + last).toUpperCase()
  // The Figma sign-up collects no name, so fall back to the last two digits of
  // the mobile number the member signed up with.
  return user.phone?.slice(-2) || 'ME'
}

// 27821234567 -> 082 123 4567, so people recognise their own number.
function displayName(user) {
  if (user.isAnonymous) return user.username
  if (user.firstName) return [user.firstName, user.lastName].filter(Boolean).join(' ')
  const digits = (user.phone || '').replace(/\D/g, '')
  const local = digits.startsWith('27') ? `0${digits.slice(2)}` : digits
  return local.length === 10 ? local.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : local || 'Your account'
}

export default function AccountBadge({ className = '', variant = 'chip' }) {
  const { user, status, unavailable, signOut } = useAuth()

  if (status === 'loading' || unavailable) return null

  if (!user) {
    return (
      <Link
        to="/login"
        className={[
          'inline-flex min-h-[36px] items-center rounded-full border border-gray-200 bg-white',
          'px-3.5 text-[13px] font-semibold text-gray-600 active:bg-gray-50',
          className,
        ].join(' ')}
      >
        Sign in
      </Link>
    )
  }

  const label = displayName(user)

  if (variant === 'full') {
    return (
      <div className={`rounded-btn border border-gray-100 bg-gray-50 p-3 ${className}`}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-bold text-white">
            {initials(user)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-gray-800">{label}</span>
            <span className="block text-[11px] text-gray-400">
              {user.isAnonymous ? 'Anonymous account' : 'Signed in'}
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="mt-2.5 min-h-[36px] w-full rounded-btn border border-gray-200 bg-white text-[12px] font-semibold text-gray-600 active:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={signOut}
      title={`${label} — tap to sign out`}
      className={[
        'inline-flex min-h-[36px] items-center gap-2 rounded-full border border-gray-200 bg-white',
        'pl-1.5 pr-3 text-[13px] font-semibold text-gray-600 active:bg-gray-50',
        className,
      ].join(' ')}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
        {initials(user)}
      </span>
      <span className="max-w-[110px] truncate">{label}</span>
    </button>
  )
}
