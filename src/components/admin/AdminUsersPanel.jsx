import { useCallback, useEffect, useState } from 'react'
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  resetAdminMfa,
  updateAdminUser,
} from '../../lib/adminApi.js'
import { useAdminSession } from '../../hooks/useAdminSession.jsx'

// Admin accounts and their roles. Only visible to someone holding
// admin:manage — the server refuses every route here otherwise, and the tab
// itself is hidden.
//
// The role list and what each role can do come from the server, so this stays
// correct when a role is added in rbac.js rather than drifting from it.

const input =
  'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand focus:outline-none'

function RoleBadge({ role }) {
  const tone =
    role === 'owner'
      ? 'bg-brand/10 text-brand'
      : role === 'admin'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-gray-100 text-gray-600'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{role}</span>
  )
}

function NewAdminForm({ roles, onCreated }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'editor', password: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }))

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createAdminUser(form)
      setForm({ email: '', name: '', role: 'editor', password: '' })
      await onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const chosen = roles.find((r) => r.name === form.role)

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-surface p-5">
      <h3 className="font-display text-[16px] font-semibold text-ink">Add an admin</h3>
      <p className="mt-1 text-sm text-gray-500">
        They set up two-factor authentication the first time they sign in — until they do, the
        account can do nothing else.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Email address</span>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => set({ email: e.target.value })}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Name (optional)</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Role</span>
          <select value={form.role} onChange={(e) => set({ role: e.target.value })} className={input}>
            {roles.map((role) => (
              <option key={role.name} value={role.name}>
                {role.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">
            Temporary password
          </span>
          <input
            type="text"
            required
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set({ password: e.target.value })}
            className={input}
          />
        </label>
      </div>

      {chosen ? (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
          Can: {chosen.permissions.join(', ')}
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand disabled:opacity-40"
      >
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </form>
  )
}

export default function AdminUsersPanel() {
  const { admin: me } = useAdminSession()
  const [admins, setAdmins] = useState([])
  const [roles, setRoles] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const body = await fetchAdminUsers()
      setAdmins(body.admins)
      setRoles(body.roles)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const act = async (fn) => {
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) return <p className="py-16 text-center text-sm text-gray-400">Loading accounts…</p>

  return (
    <div className="space-y-5">
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Admin</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              <th className="px-4 py-2.5 font-semibold">Two-factor</th>
              <th className="px-4 py-2.5 font-semibold">Last sign-in</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {admins.map((row) => {
              const isMe = row.id === me?.id
              return (
                <tr key={row.id} className={row.status === 'disabled' ? 'opacity-50' : undefined}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800">{row.name || row.email}</p>
                    <p className="text-[12px] text-gray-400">{row.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {/* Nobody may change their own role — the server refuses it
                        too, so this is a hint, not the rule. */}
                    <select
                      value={row.role}
                      disabled={isMe}
                      onChange={(e) => act(() => updateAdminUser(row.id, { role: e.target.value }))}
                      className="rounded-md border border-gray-200 px-2 py-1 text-xs disabled:border-transparent disabled:bg-transparent"
                    >
                      {roles.map((role) => (
                        <option key={role.name} value={role.name}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                    {isMe ? <RoleBadge role="you" /> : null}
                  </td>
                  <td className="px-4 py-3">
                    {row.mfaEnrolled ? (
                      <span className="text-[12px] font-semibold text-green-600">On</span>
                    ) : (
                      <span className="text-[12px] font-semibold text-amber-600">Not set up</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-gray-500">
                    {row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          act(() =>
                            updateAdminUser(row.id, {
                              status: row.status === 'active' ? 'disabled' : 'active',
                            })
                          )
                        }
                        disabled={isMe}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                      >
                        {row.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        title="Clears their second factor so they can enrol a new one, and ends their sessions"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Reset two-factor for ${row.email}? They will set it up again at their next sign-in, and any open session of theirs ends now.`
                            )
                          ) {
                            act(() => resetAdminMfa(row.id))
                          }
                        }}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                      >
                        Reset 2FA
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Delete the admin account for ${row.email}?`)) {
                            act(() => deleteAdminUser(row.id))
                          }
                        }}
                        disabled={isMe}
                        className="rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-30"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <NewAdminForm roles={roles} onCreated={load} />
    </div>
  )
}
