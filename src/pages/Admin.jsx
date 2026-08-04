import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CollectionEditor from '../components/admin/CollectionEditor.jsx'
import RawJsonEditor from '../components/admin/RawJsonEditor.jsx'
import AnalyticsPanel from '../components/admin/AnalyticsPanel.jsx'
import { DATASET_SCHEMAS } from '../components/admin/schemas.js'
import {
  adminLogin,
  fetchDataset,
  getAdminKey,
  resetDataset,
  saveDataset,
  setAdminKey,
} from '../lib/adminApi.js'

const DATASET_KEYS = Object.keys(DATASET_SCHEMAS)

// Analytics sits alongside the content datasets as a read-only tab; it has no
// draft/save cycle, so the editor toolbar is hidden while it is open.
const ANALYTICS_TAB = 'analytics'
const TABS = [...DATASET_KEYS, ANALYTICS_TAB]
const TAB_LABELS = {
  ...Object.fromEntries(DATASET_KEYS.map((k) => [k, DATASET_SCHEMAS[k].label])),
  [ANALYTICS_TAB]: 'Analytics',
}

// ---------------------------------------------------------------------------
// Login screen
// ---------------------------------------------------------------------------
function AdminLogin({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adminLogin(password)
      onSuccess()
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-7 shadow-sm"
      >
        <h1 className="font-display text-[22px] font-bold text-black">Admin</h1>
        <p className="mt-1 text-sm text-gray-500">
          Sign in to edit the content shown in the app.
        </p>
        <label className="mt-5 block">
          <span className="mb-1 block text-xs font-semibold text-gray-500">Admin password</span>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:border-brand focus:outline-none"
          />
        </label>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-5 w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <Link to="/explore" className="mt-4 block text-center text-xs text-gray-400 hover:text-gray-600">
          ← Back to the app
        </Link>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor shell
// ---------------------------------------------------------------------------
export default function Admin() {
  const [authed, setAuthed] = useState(() => Boolean(getAdminKey()))
  const [active, setActive] = useState(DATASET_KEYS[0])
  // Per-dataset { original, draft } so switching tabs never loses edits.
  const [docs, setDocs] = useState({})
  const [mode, setMode] = useState('visual') // 'visual' | 'raw'
  const [status, setStatus] = useState(null) // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false)

  const isAnalytics = active === ANALYTICS_TAB
  const schema = DATASET_SCHEMAS[active]
  const entry = docs[active]
  const dirty = useMemo(
    () => Boolean(entry) && JSON.stringify(entry.draft) !== JSON.stringify(entry.original),
    [entry]
  )

  const load = useCallback(async (key) => {
    try {
      const data = await fetchDataset(key)
      setDocs((prev) => ({ ...prev, [key]: { original: data, draft: data } }))
    } catch (err) {
      setStatus({ kind: 'error', text: err.message })
    }
  }, [])

  useEffect(() => {
    if (authed && !isAnalytics && !docs[active]) load(active)
  }, [authed, active, isAnalytics, docs, load])

  const setDraft = (draft) => {
    setDocs((prev) => ({ ...prev, [active]: { ...prev[active], draft } }))
    setStatus(null)
  }

  const save = async () => {
    setBusy(true)
    setStatus(null)
    try {
      await saveDataset(active, entry.draft)
      setDocs((prev) => ({ ...prev, [active]: { original: entry.draft, draft: entry.draft } }))
      setStatus({ kind: 'ok', text: 'Saved — changes are live.' })
    } catch (err) {
      setStatus({ kind: 'error', text: err.message })
      if (!getAdminKey()) setAuthed(false)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!window.confirm(`Reset ${schema.label} to the content shipped with the app? Your edits will be lost.`))
      return
    setBusy(true)
    setStatus(null)
    try {
      const { data } = await resetDataset(active)
      setDocs((prev) => ({ ...prev, [active]: { original: data, draft: data } }))
      setStatus({ kind: 'ok', text: 'Reset to defaults.' })
    } catch (err) {
      setStatus({ kind: 'error', text: err.message })
      if (!getAdminKey()) setAuthed(false)
    } finally {
      setBusy(false)
    }
  }

  if (!authed) return <AdminLogin onSuccess={() => setAuthed(true)} />

  return (
    <div className="min-h-screen bg-canvas">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[18px] font-bold text-black">Content admin</h1>
            {dirty ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Unsaved changes
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/explore"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              View app
            </Link>
            <button
              type="button"
              onClick={() => {
                setAdminKey('')
                setAuthed(false)
              }}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Dataset tabs */}
        <div className="mx-auto flex max-w-4xl gap-1 px-5 pb-2">
          {TABS.map((key) => {
            const isActive = key === active
            const keyDirty =
              docs[key] && JSON.stringify(docs[key].draft) !== JSON.stringify(docs[key].original)
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setActive(key)
                  setStatus(null)
                }}
                className={[
                  'rounded-lg px-3.5 py-1.5 text-sm font-semibold transition',
                  isActive ? 'bg-brand text-white' : 'text-gray-500 hover:bg-gray-100',
                ].join(' ')}
              >
                {TAB_LABELS[key]}
                {keyDirty ? ' •' : ''}
              </button>
            )
          })}
        </div>
      </header>

      <main className={`mx-auto px-5 py-6 ${isAnalytics ? 'max-w-6xl' : 'max-w-4xl'}`}>
        {isAnalytics ? (
          <>
            <p className="mb-4 text-sm text-gray-500">
              Every event recorded by the app, tied to the device that produced it and — for
              members who arrived on a WhatsApp link — to the person behind it.
            </p>
            <AnalyticsPanel />
          </>
        ) : (
          <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500">{schema.description}</p>
            {status ? (
              <p
                className={`mt-1 text-sm font-medium ${
                  status.kind === 'ok' ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {status.text}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {/* Visual / raw toggle */}
            <div className="flex rounded-lg border border-gray-200 bg-white p-0.5">
              {['visual', 'raw'].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={[
                    'rounded-md px-3 py-1 text-xs font-semibold transition',
                    mode === m ? 'bg-gray-900 text-white' : 'text-gray-500',
                  ].join(' ')}
                >
                  {m === 'visual' ? 'Visual' : 'Raw JSON'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={() => setDraft(entry.original)}
              disabled={!dirty || busy}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || busy}
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white transition disabled:opacity-40"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {!entry ? (
          <p className="py-16 text-center text-sm text-gray-400">Loading {schema.label}…</p>
        ) : mode === 'raw' ? (
          <RawJsonEditor doc={entry.draft} onChange={setDraft} />
        ) : (
          <CollectionEditor schema={schema} doc={entry.draft} onChange={setDraft} />
        )}
          </>
        )}
      </main>
    </div>
  )
}
