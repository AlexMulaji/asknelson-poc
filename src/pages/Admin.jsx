import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CollectionEditor from '../components/admin/CollectionEditor.jsx'
import RawJsonEditor from '../components/admin/RawJsonEditor.jsx'
import AnalyticsPanel from '../components/admin/AnalyticsPanel.jsx'
import AdminLogin from '../components/admin/AdminLogin.jsx'
import AdminUsersPanel from '../components/admin/AdminUsersPanel.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import { DATASET_SCHEMAS } from '../components/admin/schemas.js'
import { fetchDataset, resetDataset, saveDataset, setItemPublished } from '../lib/adminApi.js'
import { downloadJson } from '../lib/downloadJson.js'
import {
  AdminSessionProvider,
  PERMISSIONS,
  useAdminSession,
} from '../hooks/useAdminSession.jsx'

const DATASET_KEYS = Object.keys(DATASET_SCHEMAS)

const ANALYTICS_TAB = 'analytics'
const ACCOUNTS_TAB = 'accounts'

// Every tab names the permission it needs, and the tab bar is built from the
// ones the signed-in admin holds. The server checks the same permission on
// every route behind them — this only decides what is worth showing.
const TAB_PERMISSIONS = {
  ...Object.fromEntries(DATASET_KEYS.map((k) => [k, PERMISSIONS.CONTENT_READ])),
  [ANALYTICS_TAB]: PERMISSIONS.ANALYTICS_READ,
  [ACCOUNTS_TAB]: PERMISSIONS.ADMIN_MANAGE,
}

const TAB_LABELS = {
  ...Object.fromEntries(DATASET_KEYS.map((k) => [k, DATASET_SCHEMAS[k].label])),
  [ANALYTICS_TAB]: 'Analytics',
  [ACCOUNTS_TAB]: 'Admin accounts',
}

// ---------------------------------------------------------------------------
// Editor shell
// ---------------------------------------------------------------------------
function AdminShell() {
  const { admin, can, signOut } = useAdminSession()

  const tabs = useMemo(
    () => [...DATASET_KEYS, ANALYTICS_TAB, ACCOUNTS_TAB].filter((tab) => can(TAB_PERMISSIONS[tab])),
    [can]
  )

  const [active, setActive] = useState(() => tabs[0] ?? ANALYTICS_TAB)
  // Per-dataset { original, draft } so switching tabs never loses edits.
  const [docs, setDocs] = useState({})
  const [mode, setMode] = useState('visual') // 'visual' | 'raw'
  const [status, setStatus] = useState(null) // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false)

  const isDataset = DATASET_KEYS.includes(active)
  const schema = DATASET_SCHEMAS[active]
  const entry = docs[active]
  const canPublish = can(PERMISSIONS.CONTENT_PUBLISH)
  const canWrite = can(PERMISSIONS.CONTENT_WRITE)
  const dirty = useMemo(
    () => Boolean(entry) && JSON.stringify(entry.draft) !== JSON.stringify(entry.original),
    [entry]
  )

  // An admin whose role lost them the tab they were on must not be left
  // staring at a panel every request behind it will refuse.
  useEffect(() => {
    if (tabs.length && !tabs.includes(active)) setActive(tabs[0])
  }, [tabs, active])

  const load = useCallback(async (key) => {
    try {
      const data = await fetchDataset(key)
      // The server adds _publishing purely as a report; it is not part of the
      // dataset and must not be saved back into it.
      const { _publishing, ...doc } = data
      setDocs((prev) => ({ ...prev, [key]: { original: doc, draft: doc } }))
    } catch (err) {
      setStatus({ kind: 'error', text: err.message })
    }
  }, [])

  useEffect(() => {
    if (isDataset && !docs[active]) load(active)
  }, [active, isDataset, docs, load])

  const setDraft = (draft) => {
    setDocs((prev) => ({ ...prev, [active]: { ...prev[active], draft } }))
    setStatus(null)
  }

  const save = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await saveDataset(active, entry.draft)
      setDocs((prev) => ({ ...prev, [active]: { original: entry.draft, draft: entry.draft } }))
      setStatus({
        kind: 'ok',
        text: result.publishChanges?.length
          ? `Saved — ${result.publishChanges.length} visibility change(s) are live.`
          : 'Saved — changes are live.',
      })
    } catch (err) {
      // A 403 for a publish change is the common one: say what to do about it.
      setStatus({
        kind: 'error',
        text:
          err.required === PERMISSIONS.CONTENT_PUBLISH
            ? `${err.message} Ask a publisher to review it, or undo the visibility change to save your edits.`
            : err.message,
      })
    } finally {
      setBusy(false)
    }
  }

  // Publishing one item goes straight to the server rather than through the
  // draft, so an unsaved edit elsewhere in the document cannot ride along
  // with it.
  const togglePublished = async (ref, published) => {
    setBusy(true)
    setStatus(null)
    try {
      await setItemPublished(active, ref, published)
      await load(active)
      setStatus({ kind: 'ok', text: published ? 'Published.' : 'Unpublished — hidden from the app.' })
    } catch (err) {
      setStatus({ kind: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (
      !window.confirm(
        `Reset ${schema.label} to the content shipped with the app? Your edits will be lost, and everything in the original is published.`
      )
    )
      return
    setBusy(true)
    setStatus(null)
    try {
      const { data } = await resetDataset(active)
      setDocs((prev) => ({ ...prev, [active]: { original: data, draft: data } }))
      setStatus({ kind: 'ok', text: 'Reset to defaults.' })
    } catch (err) {
      setStatus({ kind: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-[18px] font-bold text-ink">AskNelson admin</h1>
            {dirty ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Unsaved changes
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle variant="icon" />
            <span className="hidden text-right text-[11px] leading-tight text-gray-400 sm:block">
              <span className="block font-semibold text-gray-600">{admin?.name || admin?.email}</span>
              {admin?.role}
            </span>
            <Link
              to="/explore"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              View app
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Log out
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-auto flex max-w-5xl flex-wrap gap-1 px-5 pb-2">
          {tabs.map((key) => {
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
                  isActive ? 'bg-brand text-on-brand' : 'text-gray-500 hover:bg-gray-100',
                ].join(' ')}
              >
                {TAB_LABELS[key]}
                {keyDirty ? ' •' : ''}
              </button>
            )
          })}
        </div>
      </header>

      <main className={`mx-auto px-5 py-6 ${isDataset ? 'max-w-4xl' : 'max-w-6xl'}`}>
        {tabs.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-400">
            Your role ({admin?.role}) has no panels enabled. Ask an owner to adjust it.
          </p>
        ) : active === ACCOUNTS_TAB ? (
          <AdminUsersPanel />
        ) : active === ANALYTICS_TAB ? (
          <>
            <p className="mb-4 text-sm text-gray-500">
              Every event recorded by the app, filterable by company and date, and — for members
              who arrived on a WhatsApp link — traceable to the person behind it.
            </p>
            <AnalyticsPanel />
          </>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-500">{schema.description}</p>
                {!canPublish ? (
                  <p className="mt-1 text-[12px] text-amber-600">
                    Your role can edit content but not publish it — draft freely, then ask a
                    publisher to make it live.
                  </p>
                ) : null}
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
                <div className="flex rounded-lg border border-gray-200 bg-surface p-0.5">
                  {['visual', 'raw'].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={[
                        'rounded-md px-3 py-1 text-xs font-semibold transition',
                        mode === m ? 'bg-ink text-surface' : 'text-gray-500',
                      ].join(' ')}
                    >
                      {m === 'visual' ? 'Visual' : 'Raw JSON'}
                    </button>
                  ))}
                </div>

                {/* Export the dataset so it can be committed to the repo. Saves
                    what's on screen, so unsaved edits can be rescued too. */}
                <button
                  type="button"
                  onClick={() => downloadJson(`${active}.json`, entry.draft)}
                  disabled={!entry}
                  title={
                    dirty
                      ? 'Downloads the unsaved version currently on screen'
                      : `Download ${active}.json to commit into src/data/`
                  }
                  className="rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  Download JSON{dirty ? ' *' : ''}
                </button>
                {canPublish ? (
                  <button
                    type="button"
                    onClick={reset}
                    disabled={busy}
                    className="rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Reset to defaults
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setDraft(entry.original)}
                  disabled={!dirty || busy}
                  className="rounded-lg border border-gray-200 bg-surface px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                >
                  Discard
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty || busy || !canWrite}
                  title={canWrite ? undefined : 'Your role is read-only for content'}
                  className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-on-brand transition disabled:opacity-40"
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
              <CollectionEditor
                schema={schema}
                doc={entry.draft}
                onChange={setDraft}
                canPublish={canPublish}
                busy={busy}
                onTogglePublished={togglePublished}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

function AdminRoot() {
  const { status } = useAdminSession()
  if (status === 'loading') {
    return <p className="py-24 text-center text-sm text-gray-400">Checking your session…</p>
  }
  return status === 'signed_in' ? <AdminShell /> : <AdminLogin />
}

export default function Admin() {
  return (
    <AdminSessionProvider>
      <AdminRoot />
    </AdminSessionProvider>
  )
}
