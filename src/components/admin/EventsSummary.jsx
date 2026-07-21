import { useCallback, useEffect, useState } from 'react'
import { fetchEventsSummary } from '../../lib/adminApi.js'

function Panel({ title, hint, children }) {
  return (
    <div className="rounded-card border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-black">{title}</h3>
      {hint ? <p className="mt-0.5 text-xs text-gray-400">{hint}</p> : null}
      <div className="mt-3">{children}</div>
    </div>
  )
}

function CountList({ rows, labelKey, emptyText }) {
  if (!rows.length) return <p className="text-sm text-gray-400">{emptyText}</p>
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm text-gray-700">{r[labelKey] ?? '—'}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
            <span
              className="block h-full rounded-full bg-brand"
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </span>
          <span className="w-10 shrink-0 text-right text-xs font-semibold text-gray-500">
            {r.count}
          </span>
        </li>
      ))}
    </ul>
  )
}

// Simple counts read straight from the events table — see server/db.js
// eventsSummary(). Assessment activity is grouped by pseudo_id only, so this
// view can show engagement without ever naming who did which assessment.
export default function EventsSummary() {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setSummary(await fetchEventsSummary())
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (error) return <p className="text-sm font-medium text-red-600">{error}</p>
  if (!summary) return <p className="py-16 text-center text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          What members are clicking on, refreshed on demand.
        </p>
        <button
          type="button"
          onClick={load}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Events by type" hint="Total count per tracked action">
          <CountList rows={summary.byType} labelKey="type" emptyText="No events recorded yet." />
        </Panel>

        <Panel title="Most viewed pages" hint="Top 20 routes by page view">
          <CountList rows={summary.byPath} labelKey="path" emptyText="No page views recorded yet." />
        </Panel>

        <Panel title="Most active members" hint="Non-sensitive events only — clicks, page views, journeys, meditation">
          <CountList
            rows={summary.topMembers}
            labelKey="label"
            emptyText="No member activity recorded yet."
          />
        </Panel>

        <Panel
          title="Assessment engagement"
          hint="Pseudonymized — grouped by an anonymous id, never linked to a member"
        >
          {summary.assessments.length === 0 ? (
            <p className="text-sm text-gray-400">No assessment activity recorded yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm text-gray-700">
              {summary.assessments.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    <span className="font-mono text-xs text-gray-400">{a.pseudo_id.slice(0, 8)}…</span>
                    {' — '}
                    {a.payload?.assessmentId || 'unknown'}
                    {a.payload?.band ? ` · ${a.payload.band}` : ''}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-gray-500">{a.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}
