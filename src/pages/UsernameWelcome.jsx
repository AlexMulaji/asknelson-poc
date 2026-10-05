import { useState } from 'react'
import { Btn } from '../components/auth/authPrims.jsx'
import { CheckIcon } from '../components/Icons.jsx'
import { useAuth } from '../hooks/useAuth.jsx'
import '../assets/auth/auth_style.css'

// Shown once, before the app, to every member who hasn't yet seen it: new
// registrations straight after verifying, and existing accounts -- who were
// given a handle by migration 006 -- on their next sign-in.
//
// It explains the generated username ("CalmRiver4821"): that it's the name the
// app shows for them, and that it exists to keep them anonymous. App.jsx gates
// on `user.usernameAcknowledged`; Continue records it server-side, so the
// screen never comes back on this or any other device.

const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000

export default function UsernameWelcome() {
  const { user, acknowledgeUsername } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Someone who registered just now gets the design's "account created"
  // wording; an older account is meeting its handle for the first time.
  const isNew = user?.createdAt && Date.now() - new Date(user.createdAt).getTime() < NEW_ACCOUNT_MS

  const onContinue = async () => {
    setSaving(true)
    setError('')
    try {
      await acknowledgeUsername()
      // Nothing else to do: the updated user lifts the gate and App renders
      // whatever page the member was headed for.
    } catch {
      setSaving(false)
      setError('We couldn’t save that just now. Please check your connection and try again.')
    }
  }

  return (
    <main className="screen screen--welcome">
      <div className="screen__inner">
        <div className="success-ic">
          <CheckIcon strokeWidth={2.4} />
        </div>
        <h1>
          {isNew ? (
            <>
              Account Has Been
              <br />
              Successfully Created
            </>
          ) : (
            'Meet Your Anonymous Username'
          )}
        </h1>
        <p className="sub">
          {isNew
            ? 'To keep your identity private, you’ll be given an anonymous username.'
            : 'To keep your identity private, you’ve been given an anonymous username. It’s the only name the app shows for you.'}
        </p>

        <div className="username-box">
          <small>Your Anonymous Username is</small>
          <strong>{user?.username}</strong>
        </div>

        {error ? (
          <p role="alert" className="welcome-error">
            {error}
          </p>
        ) : null}

        <Btn label={saving ? 'Saving' : 'Continue'} loading={saving} onClick={onContinue} />
      </div>
    </main>
  )
}
