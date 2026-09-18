import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createLinkToken,
  downloadEventsCsv,
  fetchCompanyReport,
  fetchDevice,
  fetchEventsByCompany,
  fetchLinkTokens,
  fetchOrganisations,
  fetchOverview,
  fetchSessions,
  revokeLinkToken,
} from '../../lib/adminApi.js'
import { PERMISSIONS, useAdminSession } from '../../hooks/useAdminSession.jsx'
import { filterCompanies, formatDuration } from '../../lib/companyTable.js'

const WINDOWS = [7, 30, 90]

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortId(id) {
  return id ? `${id.slice(0, 8)}…` : '—'
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 font-display text-[24px] font-semibold text-ink">{value ?? '—'}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p> : null}
    </div>
  )
}

// A dependency-free bar chart. Volumes here are small and the shape is all that
// matters, so a charting library would be more weight than it is worth.
function DailyChart({ daily }) {
  if (!daily?.length) {
    return <p className="py-8 text-center text-sm text-gray-400">No events in this window yet.</p>
  }
  const max = Math.max(...daily.map((d) => d.events), 1)
  return (
    <div className="flex h-32 items-end gap-1 overflow-x-auto">
      {daily.map((d) => (
        <div key={d.day} className="flex min-w-[8px] flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-brand/80"
            style={{ height: `${Math.max((d.events / max) * 100, 2)}%` }}
            title={`${d.day}: ${d.events} events, ${d.devices} devices`}
          />
        </div>
      ))}
    </div>
  )
}

// --- link tokens --------------------------------------------------------------

function LinkTokens() {
  const [tokens, setTokens] = useState([])
  const [externalRef, setExternalRef] = useState('')
  const [label, setLabel] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('')
  const [minted, setMinted] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const { tokens: rows } = await fetchLinkTokens()
      setTokens(rows)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const mint = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await createLinkToken({
        externalRef: externalRef.trim(),
        label: label.trim() || null,
        expiresInDays: expiresInDays ? Number(expiresInDays) : null,
      })
      setMinted(result)
      setExternalRef('')
      setLabel('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (hash) => {
    if (!window.confirm('Revoke this link? Anyone who still has it will land anonymously.')) return
    try {
      await revokeLinkToken(hash)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-surface p-5">
      <h3 className="font-display text-[16px] font-semibold text-ink">WhatsApp links</h3>
      <p className="mt-1 text-sm text-gray-500">
        Mint one link per member and send it over WhatsApp. When they open it, their device is
        bound to that member and every event from then on is attributed to them.
      </p>

      <form onSubmit={mint} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-[180px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-gray-500">
            Member reference <span className="font-normal text-gray-400">(your system's id)</span>
          </span>
          <input
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="EMP-10432"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="min-w-[140px] flex-1">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="March campaign"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <label className="w-28">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Expires (days)</span>
          <input
            type="number"
            min="1"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="never"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !externalRef.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition disabled:opacity-40"
        >
          {busy ? 'Creating…' : 'Create link'}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {/* The raw token exists only in this response — after a refresh it is gone
          for good and a new link must be minted. */}
      {minted ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-semibold text-green-800">
            Link for {minted.externalRef} — copy it now, it is not shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto whitespace-nowrap rounded border border-green-200 bg-surface px-3 py-2 text-xs text-gray-700">
              {minted.url}
            </code>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(minted.url)}
              className="rounded-lg border border-green-300 bg-surface px-3 py-2 text-xs font-semibold text-green-800"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setMinted(null)}
              className="rounded-lg px-2 py-2 text-xs font-semibold text-gray-500"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {tokens.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-gray-400">
              <tr>
                <th className="pb-2 pr-4 font-semibold">Member</th>
                <th className="pb-2 pr-4 font-semibold">Label</th>
                <th className="pb-2 pr-4 font-semibold">Created</th>
                <th className="pb-2 pr-4 font-semibold">First opened</th>
                <th className="pb-2 pr-4 font-semibold">Opens</th>
                <th className="pb-2 pr-4 font-semibold">Devices</th>
                <th className="pb-2 font-semibold" />
              </tr>
            </thead>
            <tbody className="text-gray-600">
              {tokens.map((t) => (
                <tr key={t.token_hash} className="border-t border-gray-100">
                  <td className="py-2 pr-4 font-medium text-gray-800">{t.external_ref}</td>
                  <td className="py-2 pr-4">{t.label || '—'}</td>
                  <td className="py-2 pr-4">{formatDate(t.created_at)}</td>
                  <td className="py-2 pr-4">{formatDate(t.first_used_at)}</td>
                  <td className="py-2 pr-4">{t.use_count}</td>
                  <td className="py-2 pr-4">{t.devices}</td>
                  <td className="py-2 text-right">
                    {t.revoked_at ? (
                      <span className="text-xs text-gray-400">Revoked</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => revoke(t.token_hash)}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}

// --- device drill-down --------------------------------------------------------

function DeviceDetail({ deviceId, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    fetchDevice(deviceId)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [deviceId])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-xl overflow-y-auto bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-[17px] font-semibold text-ink">Device timeline</h3>
            <p className="mt-0.5 font-mono text-xs text-gray-400">{deviceId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600"
          >
            Close
          </button>
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {!data && !error ? <p className="mt-6 text-sm text-gray-400">Loading…</p> : null}

        {data ? (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[11px] uppercase text-gray-400">Member</dt>
                <dd className="font-medium text-gray-800">
                  {data.device.external_ref || 'Anonymous'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-gray-400">Arrived via</dt>
                <dd className="text-gray-700">
                  {data.device.is_whatsapp ? 'WhatsApp' : 'Direct / other'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-gray-400">First seen</dt>
                <dd className="text-gray-700">{formatDate(data.device.first_seen_at)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-gray-400">Last seen</dt>
                <dd className="text-gray-700">{formatDate(data.device.last_seen_at)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-gray-400">Sessions</dt>
                <dd className="text-gray-700">{data.device.session_count}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-gray-400">Events</dt>
                <dd className="text-gray-700">{data.device.event_count}</dd>
              </div>
            </dl>

            <h4 className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              Recent events
            </h4>
            <ul className="mt-2 space-y-1.5">
              {data.events.map((e) => (
                <li key={e.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-gray-800">{e.name}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">
                      {formatDate(e.occurred_at)}
                    </span>
                  </div>
                  {e.path ? <p className="text-[11px] text-gray-500">{e.path}</p> : null}
                  {e.props && Object.keys(e.props).length > 0 ? (
                    <p className="mt-0.5 break-words font-mono text-[11px] text-gray-500">
                      {JSON.stringify(e.props)}
                    </p>
                  ) : null}
                </li>
              ))}
              {data.events.length === 0 ? (
                <li className="py-4 text-sm text-gray-400">No events recorded.</li>
              ) : null}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  )
}

// --- per-company reporting -------------------------------------------------------

// One company in depth: what its people actually do, and what they read.
// Opened from the company table; closes back to the all-companies view.
function CompanyReport({ organisationId, filters, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setData(null)
    setError(null)
    // The company is in the path, so the org filter is dropped from the query
    // — sending both would just be the same constraint twice.
    const { organisationId: _ignored, ...rest } = filters
    fetchCompanyReport(organisationId, rest)
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [organisationId, filters])

  return (
    <section className="rounded-xl border border-brand/30 bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-[16px] font-semibold text-ink">
            {data?.organisation?.name ?? 'Company report'}
          </h3>
          <p className="mt-0.5 text-[12px] text-gray-400">
            Everything this company&apos;s people did in the selected window.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Close
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      {!data && !error ? <p className="mt-6 text-sm text-gray-400">Loading…</p> : null}

      {data ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Events" value={data.totals.events} />
            <Stat label="Sessions" value={data.totals.sessions} />
            <Stat label="Devices" value={data.totals.devices} />
            <Stat label="Unique users" value={data.totals.members} />
            <Stat
              label="Time in app"
              value={formatDuration(data.totals.time_spent_seconds)}
              hint="Total session length"
            />
          </div>

          <div className="mt-4">
            <DailyChart daily={data.daily} />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Most popular events
              </h4>
              <ul className="mt-2 space-y-1.5">
                {data.topEvents.map((row) => (
                  <li key={row.name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-gray-700">{row.name}</span>
                    <span className="shrink-0 text-gray-400">
                      <span className="font-semibold text-gray-900">{row.count}</span> ·{' '}
                      {row.devices} device(s)
                    </span>
                  </li>
                ))}
                {data.topEvents.length === 0 ? (
                  <li className="py-4 text-sm text-gray-400">Nothing recorded in this window.</li>
                ) : null}
              </ul>
            </div>

            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Most opened content
              </h4>
              <ul className="mt-2 space-y-1.5">
                {data.topContent.map((row) => (
                  <li
                    key={`${row.theme}-${row.title}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="truncate text-gray-700" title={row.title}>
                      {row.title}
                    </span>
                    <span className="shrink-0 font-semibold text-gray-900">{row.opens}</span>
                  </li>
                ))}
                {data.topContent.length === 0 ? (
                  <li className="py-4 text-sm text-gray-400">No content opened in this window.</li>
                ) : null}
              </ul>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}

const COMPANY_COLUMNS = [
  { key: 'name', label: 'Company' },
  { key: 'events', label: 'Events' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'members', label: 'Unique users' },
  {
    key: 'time_spent_seconds',
    label: 'Time in app',
    title: 'Total session length in the selected window. Not narrowed by the event filter.',
  },
]

const filterInput =
  'rounded-lg border border-gray-200 bg-surface px-2.5 py-1.5 text-xs text-gray-700 focus:border-brand focus:outline-none'

// Every company side by side, with its busiest events. The answer to "who is
// using this, and for what" without opening a single member record.
function CompanyTable({ filters, onSelect }) {
  const [rows, setRows] = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const [unattributed, setUnattributed] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [minEvents, setMinEvents] = useState('')
  const [minUsers, setMinUsers] = useState('')
  const [sort, setSort] = useState({ by: 'events', direction: 'desc' })

  const visible = useMemo(
    () =>
      filterCompanies(rows, {
        search,
        minEvents,
        minUsers,
        organisationId: filters.organisationId,
        sortBy: sort.by,
        direction: sort.direction,
      }),
    [rows, search, minEvents, minUsers, filters.organisationId, sort]
  )

  // Clicking the active column flips it; a new column starts A–Z for names
  // and biggest-first for numbers, which is what people look for first.
  const sortOn = (key) =>
    setSort((s) =>
      s.by === key
        ? { by: key, direction: s.direction === 'asc' ? 'desc' : 'asc' }
        : { by: key, direction: key === 'name' ? 'asc' : 'desc' }
    )

  const narrowed = search || minEvents || minUsers

  useEffect(() => {
    let alive = true
    Promise.all([fetchOrganisations(filters), fetchEventsByCompany(filters)])
      .then(([orgs, by]) => {
        if (!alive) return
        setRows(orgs.organisations)
        setUnattributed(orgs.unattributed)
        setBreakdown(new Map(by.companies.map((c) => [c.organisationId, c.topEvents])))
      })
      .catch((err) => alive && setError(err.message))
    return () => {
      alive = false
    }
  }, [filters])

  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!rows) return <p className="py-8 text-center text-sm text-gray-400">Loading companies…</p>

  return (
    <section className="rounded-xl border border-gray-200 bg-surface p-5">
      <h3 className="font-display text-[16px] font-semibold text-ink">By company</h3>
      <p className="mt-0.5 text-[12px] text-gray-400">
        Activity per employer, with each one&apos;s three busiest events. Click a column to sort, or
        a row for the full report.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search companies"
          aria-label="Search companies"
          className={`${filterInput} min-w-[160px] flex-1`}
        />
        <input
          type="number"
          min="0"
          value={minEvents}
          onChange={(e) => setMinEvents(e.target.value)}
          placeholder="Min events"
          aria-label="Minimum events"
          className={`${filterInput} w-28`}
        />
        <input
          type="number"
          min="0"
          value={minUsers}
          onChange={(e) => setMinUsers(e.target.value)}
          placeholder="Min unique users"
          aria-label="Minimum unique users"
          className={`${filterInput} w-36`}
        />
        {narrowed ? (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setMinEvents('')
              setMinUsers('')
            }}
            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-gray-400">
            <tr>
              {COMPANY_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="pb-2 pr-4 font-semibold"
                  aria-sort={
                    sort.by === col.key
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => sortOn(col.key)}
                    title={col.title}
                    className={[
                      'uppercase tracking-wide hover:text-gray-700',
                      sort.by === col.key ? 'text-gray-700' : '',
                    ].join(' ')}
                  >
                    {col.label}
                    {sort.by === col.key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
              <th className="pb-2 font-semibold">Most popular</th>
            </tr>
          </thead>
          <tbody className="text-gray-600">
            {visible.map((row) => (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                className="cursor-pointer border-t border-gray-100 hover:bg-gray-50"
              >
                <td className="py-2 pr-4 font-medium text-gray-800">{row.name}</td>
                <td className="py-2 pr-4">{row.events}</td>
                <td className="py-2 pr-4">{row.sessions}</td>
                <td className="py-2 pr-4">{row.members}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {formatDuration(row.time_spent_seconds)}
                </td>
                <td className="py-2 text-[12px] text-gray-500">
                  {(breakdown?.get(row.id) ?? [])
                    .slice(0, 3)
                    .map((e) => `${e.name} (${e.count})`)
                    .join(', ') || '—'}
                </td>
              </tr>
            ))}
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-gray-400">
                  {rows.length === 0
                    ? 'No company activity in this window.'
                    : 'No companies match these filters.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {unattributed?.events > 0 ? (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-500">
          {unattributed.events} event(s) in this window belong to no company — anonymous accounts,
          which are never linked to an employer by design, and visits that happened before the
          person signed in. They are counted in the totals above but not in any company row.
        </p>
      ) : null}
    </section>
  )
}

// --- panel --------------------------------------------------------------------

export default function AnalyticsPanel() {
  const { can } = useAdminSession()
  const [days, setDays] = useState(30)
  const [organisationId, setOrganisationId] = useState('')
  const [eventName, setEventName] = useState('')
  const [overview, setOverview] = useState(null)
  const [sessions, setSessions] = useState([])
  const [companies, setCompanies] = useState([])
  const [openCompany, setOpenCompany] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [openDevice, setOpenDevice] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  // One object, so every panel and the CSV export are filtered identically —
  // and memoised, because it is a dependency of the child effects.
  const filters = useMemo(
    () => ({ days, organisationId: organisationId || undefined, name: eventName || undefined }),
    [days, organisationId, eventName]
  )

  const canDrillIntoDevices = can(PERMISSIONS.ANALYTICS_READ_PII)
  const canExport = can(PERMISSIONS.ANALYTICS_EXPORT)

  const load = useCallback(async (active) => {
    setLoading(true)
    setError(null)
    try {
      const [o, s] = await Promise.all([
        fetchOverview(active),
        fetchSessions({ ...active, limit: 50 }),
      ])
      setOverview(o)
      setSessions(s.sessions)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(filters)
  }, [filters, load, reloadKey])

  // The company picker lists every company with activity in the window, so it
  // is loaded independently of whichever company is currently selected.
  useEffect(() => {
    let alive = true
    fetchOrganisations({ days })
      .then((body) => alive && setCompanies(body.organisations))
      .catch(() => {
        /* the picker simply stays empty; the error surfaces on the main load */
      })
    return () => {
      alive = false
    }
  }, [days, reloadKey])

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-900">Analytics unavailable</p>
        <p className="mt-1 text-sm text-amber-800">{error}</p>
      </div>
    )
  }

  const totals = overview?.totals ?? {}
  const linkage = overview?.deviceLinkage ?? {}
  const eventNames = overview?.byName ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 bg-surface p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setDays(w)}
                className={[
                  'rounded-md px-3 py-1 text-xs font-semibold transition',
                  days === w ? 'bg-ink text-surface' : 'text-gray-500',
                ].join(' ')}
              >
                {w} days
              </button>
            ))}
          </div>

          <select
            value={organisationId}
            onChange={(e) => {
              setOrganisationId(e.target.value)
              setOpenCompany(null)
            }}
            className="rounded-lg border border-gray-200 bg-surface px-2.5 py-1.5 text-xs font-semibold text-gray-600"
          >
            <option value="">All companies</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.events})
              </option>
            ))}
          </select>

          <select
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            className="rounded-lg border border-gray-200 bg-surface px-2.5 py-1.5 text-xs font-semibold text-gray-600"
          >
            <option value="">All events</option>
            {eventNames.map((row) => (
              <option key={row.name} value={row.name}>
                {row.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            Refresh
          </button>
          {canExport ? (
            <button
              type="button"
              onClick={() => downloadEventsCsv(filters).catch((err) => setError(err.message))}
              className="rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Export CSV
            </button>
          ) : null}
        </div>
      </div>

      {loading && !overview ? (
        <p className="py-16 text-center text-sm text-gray-400">Loading analytics…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label="Events" value={totals.events} />
            <Stat label="Sessions" value={totals.sessions} />
            <Stat
              label="Unique users"
              value={totals.unique_users}
              hint="Linked people, else devices"
            />
            <Stat
              label="Time in app"
              value={formatDuration(totals.time_spent_seconds)}
              hint="Total session length"
            />
            <Stat label="Devices" value={totals.devices} />
            <Stat label="Companies" value={totals.companies} />
            <Stat
              label="Identified"
              value={totals.members}
              hint={`${linkage.linked}/${linkage.total} devices linked`}
            />
          </div>

          <section className="rounded-xl border border-gray-200 bg-surface p-5">
            <h3 className="font-display text-[16px] font-semibold text-ink">
              Daily activity
              <span className="ml-2 text-[12px] font-normal text-gray-400">
                {totals.whatsapp_sessions} of {totals.sessions} sessions arrived from WhatsApp
              </span>
            </h3>
            <div className="mt-4">
              <DailyChart daily={overview?.daily} />
            </div>
          </section>

          {openCompany ? (
            <CompanyReport
              organisationId={openCompany}
              filters={filters}
              onClose={() => setOpenCompany(null)}
            />
          ) : (
            <CompanyTable filters={filters} onSelect={setOpenCompany} />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-gray-200 bg-surface p-5">
              <h3 className="font-display text-[16px] font-semibold text-ink">Events by type</h3>
              <ul className="mt-3 space-y-1.5">
                {eventNames.slice(0, 15).map((row) => (
                  <li key={row.name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-gray-700">{row.name}</span>
                    <span className="shrink-0 font-semibold text-gray-900">{row.count}</span>
                  </li>
                ))}
                {eventNames.length === 0 ? (
                  <li className="py-4 text-sm text-gray-400">Nothing recorded yet.</li>
                ) : null}
              </ul>
            </section>

            <section className="rounded-xl border border-gray-200 bg-surface p-5">
              <h3 className="font-display text-[16px] font-semibold text-ink">Most opened content</h3>
              <ul className="mt-3 space-y-1.5">
                {(overview?.topContent ?? []).map((row) => (
                  <li
                    key={`${row.theme}-${row.title}`}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="truncate text-gray-700" title={row.title}>
                      {row.title}
                    </span>
                    <span className="shrink-0 font-semibold text-gray-900">{row.opens}</span>
                  </li>
                ))}
                {(overview?.topContent ?? []).length === 0 ? (
                  <li className="py-4 text-sm text-gray-400">No content opened yet.</li>
                ) : null}
              </ul>
            </section>
          </div>

          <section className="rounded-xl border border-gray-200 bg-surface p-5">
            <h3 className="font-display text-[16px] font-semibold text-ink">Recent sessions</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="pb-2 pr-4 font-semibold">Started</th>
                    <th className="pb-2 pr-4 font-semibold">Member</th>
                    <th className="pb-2 pr-4 font-semibold">Company</th>
                    <th className="pb-2 pr-4 font-semibold">Device</th>
                    <th className="pb-2 pr-4 font-semibold">Source</th>
                    <th className="pb-2 pr-4 font-semibold">Entry</th>
                    <th className="pb-2 pr-4 font-semibold">Length</th>
                    <th className="pb-2 font-semibold">Events</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600">
                  {sessions.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => canDrillIntoDevices && setOpenDevice(s.device_id)}
                      title={
                        canDrillIntoDevices
                          ? undefined
                          : 'Your role cannot open individual member activity'
                      }
                      className={[
                        'border-t border-gray-100',
                        canDrillIntoDevices ? 'cursor-pointer hover:bg-gray-50' : '',
                      ].join(' ')}
                    >
                      <td className="py-2 pr-4 whitespace-nowrap">{formatDate(s.started_at)}</td>
                      <td className="py-2 pr-4 font-medium text-gray-800">
                        {s.external_ref || <span className="text-gray-400">Anonymous</span>}
                      </td>
                      <td className="py-2 pr-4">
                        {s.organisation || <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{shortId(s.device_id)}</td>
                      <td className="py-2 pr-4">
                        {s.is_whatsapp ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                            WhatsApp
                          </span>
                        ) : (
                          s.source || '—'
                        )}
                      </td>
                      <td className="py-2 pr-4">{s.entry_path || '—'}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {formatDuration(s.duration_seconds)}
                      </td>
                      <td className="py-2">{s.event_count}</td>
                    </tr>
                  ))}
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-gray-400">
                        No sessions recorded yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {canDrillIntoDevices ? <LinkTokens /> : null}
        </>
      )}

      {openDevice ? (
        <DeviceDetail deviceId={openDevice} onClose={() => setOpenDevice(null)} />
      ) : null}
    </div>
  )
}
