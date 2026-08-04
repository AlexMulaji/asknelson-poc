import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.jsx'

// The account affordance: a "Sign in" link when signed out, a name chip with a
// sign-out control when signed in.
//
// An account is optional throughout the app, so this never nags and never
// blocks — it is a quiet control in the corner. It renders nothing at all while
// the session is still resolving, or when the server has no database and so
// cannot offer accounts.

function initials(user) {
  if (user.isAnonymous) return user.username?.slice(0, 2).toUpperCase() || 'AN'
  const first = user.firstName?.[0] ?? ''
  const last = user.lastName?.[0] ?? ''
  return (first + last).toUpperCase() || 'ME'
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

  const label = user.isAnonymous ? user.username : user.firstName || 'Your account'

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
              {user.isAnonymous ? 'Anonymous account' : user.employer || 'Signed in'}
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
      <span className="max-w-[100px] truncate">{label}</span>
    </button>
  )
}
