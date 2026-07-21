import { useCallback, useEffect, useState } from 'react'
import { createMember, fetchMembers, revokeMember } from '../../lib/adminApi.js'

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 ' +
  'placeholder:text-gray-300 focus:border-brand focus:outline-none'

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// Each row's own copy-link affordance — every member has a different token,
// so the link has to be regenerated (or re-shown) per row, not once globally.
function CopyLinkButton({ token }) {
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/?t=${token}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy this link:', link)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
    >
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}

export default function MembersManager() {
  const [members, setMembers] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [externalRef, setExternalRef] = useState('')
  const [newLink, setNewLink] = useState(null) // { label, link } — shown once, right after creation

  const load = useCallback(async () => {
    try {
      setMembers(await fetchMembers())
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const submit = async (e) => {
    e.preventDefault()
    if (!label.trim()) return
    setBusy(true)
    setError(null)
    try {
      const { member, link } = await createMember({ label: label.trim(), externalRef: externalRef.trim() })
      setNewLink({ label: member.label, link })
      setLabel('')
      setExternalRef('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const doRevoke = async (member) => {
    if (!window.confirm(`Revoke ${member.label}'s link? They'll be signed out on next load.`)) return
    setError(null)
    try {
      await revokeMember(member.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-500">
          Add a member to generate their personal WhatsApp link. Each link identifies exactly one
          person — send it to them once; opening it links their device.
        </p>
        {error ? <p className="mt-1 text-sm font-medium text-red-600">{error}</p> : null}
      </div>

      <form
        onSubmit={submit}
        className="flex flex-wrap items-end gap-3 rounded-card border border-gray-200 bg-white p-4"
      >
        <label className="min-w-[180px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Name / label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Jane D."
            className={inputClass}
          />
        </label>
        <label className="min-w-[180px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-gray-500">
            Employee ID / phone (optional)
          </span>
          <input
            type="text"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="optional"
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !label.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-40"
        >
          {busy ? 'Adding…' : 'Add member'}
        </button>
      </form>

      {newLink ? (
        <div className="rounded-card border border-brand-green/30 bg-brand-green/5 p-4">
          <p className="text-sm font-semibold text-black">Link ready for {newLink.label}</p>
          <p className="mt-1 break-all font-mono text-xs text-gray-600">{newLink.link}</p>
          <div className="mt-2 flex gap-2">
            <CopyLinkButton token={newLink.link.split('t=')[1]} />
            <button
              type="button"
              onClick={() => setNewLink(null)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-card border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5">Member</th>
              <th className="px-4 py-2.5">Added</th>
              <th className="px-4 py-2.5">Last seen</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {members === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No members yet — add one above to generate their first link.
                </td>
              </tr>
            ) : (
              members.map((m) => {
                const revoked = Boolean(m.revoked_at)
                return (
                  <tr key={m.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-black">{m.label}</div>
                      {m.external_ref ? (
                        <div className="text-xs text-gray-400">{m.external_ref}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{formatDate(m.created_at)}</td>
                    <td className="px-4 py-2.5 text-gray-500">{formatDate(m.last_seen_at)}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          revoked ? 'bg-red-50 text-red-600' : 'bg-brand-green/10 text-brand-green',
                        ].join(' ')}
                      >
                        {revoked ? 'Revoked' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-2">
                        {!revoked ? <CopyLinkButton token={m.token} /> : null}
                        {!revoked ? (
                          <button
                            type="button"
                            onClick={() => doRevoke(m)}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                          >
                            Revoke
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
