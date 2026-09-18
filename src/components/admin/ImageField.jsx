import { useEffect, useRef, useState } from 'react'
import { deleteUpload, listUploads, uploadImage } from '../../lib/adminApi.js'
import { compressImage, formatBytes } from '../../lib/imageCompression.js'

// Image picker used by any schema field of `type: 'image'`. The stored value is
// always just a URL string — an uploaded `/uploads/…` path or an external link
// pasted by hand — so nothing about the JSON shape depends on this component.
//
// Uploads are downscaled and re-encoded in the browser first
// (lib/imageCompression.js), which is what makes the cards in the app load
// quickly: a 3 MB camera JPEG becomes a ~150 KB WebP at the size it is
// actually displayed, and the original never crosses the network. The server
// enforces the same limits regardless — a browser can be bypassed.

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

// The uploads listing is shared by every picker on the page and rarely changes,
// so it's fetched once per session and refreshed on write.
let uploadsCache = null
let limitsCache = null
const subscribers = new Set()

function publishUploads(next) {
  uploadsCache = next
  subscribers.forEach((fn) => fn(next))
}

async function refreshUploads() {
  const { uploads, limits } = await listUploads()
  limitsCache = limits
  publishUploads(uploads)
}

function useUploads() {
  const [uploads, setUploads] = useState(uploadsCache ?? [])
  const [error, setError] = useState(null)

  useEffect(() => {
    subscribers.add(setUploads)
    if (uploadsCache === null) {
      refreshUploads().catch((err) => setError(err.message))
    }
    return () => {
      subscribers.delete(setUploads)
    }
  }, [])

  return { uploads, error, setError }
}

function Thumb({ url, alt, className = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])

  if (failed) {
    return (
      <div
        className={`grid place-items-center bg-gray-100 text-[10px] text-gray-400 ${className}`}
        title={`Could not load ${url}`}
      >
        broken
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`bg-gray-100 object-cover ${className}`}
    />
  )
}

export default function ImageField({ field, value, onChange }) {
  const { uploads, error: listError, setError: setListError } = useUploads()
  const [browsing, setBrowsing] = useState(false)
  const [busy, setBusy] = useState(null) // null | 'optimising' | 'uploading'
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const fileRef = useRef(null)

  const shownError = error || listError

  const handleFiles = async (files) => {
    const file = files?.[0]
    if (!file) return
    setError(null)
    setNote(null)
    setListError(null)
    try {
      setBusy('optimising')
      const optimised = await compressImage(file)
      setBusy('uploading')
      const result = await uploadImage(optimised.file)
      onChange(result.url)
      setNote(
        optimised.compressed
          ? `Optimised: ${formatBytes(optimised.originalSize)} → ${formatBytes(optimised.size)} at ${optimised.width}×${optimised.height}.`
          : result.warning || null
      )
      await refreshUploads()
      setBrowsing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const remove = async (name) => {
    if (!window.confirm(`Delete ${name} from the library? Anything still using it will break.`))
      return
    try {
      await deleteUpload(name)
      await refreshUploads()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500">{field.label}</span>

      <div className="rounded-lg border border-gray-200 bg-surface p-2.5">
        <div className="flex items-start gap-3">
          {value ? (
            <Thumb url={value} alt="" className="h-16 w-24 shrink-0 rounded-md" />
          ) : (
            <div className="grid h-16 w-24 shrink-0 place-items-center rounded-md border border-dashed border-gray-200 text-[10px] text-gray-400">
              No image
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => fileRef.current?.click()}
                className="rounded-md bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand transition hover:bg-brand/20 disabled:opacity-40"
              >
                {busy === 'optimising' ? 'Optimising…' : busy === 'uploading' ? 'Uploading…' : 'Upload'}
              </button>
              <button
                type="button"
                onClick={() => setBrowsing((b) => !b)}
                className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                {browsing ? 'Close library' : `Library (${uploads.length})`}
              </button>
              {value ? (
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  className="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-red-500 transition hover:bg-red-50"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {/* Manual entry keeps external/CDN URLs available. */}
            <input
              type="text"
              value={value ?? ''}
              placeholder="/uploads/… or https://…"
              onChange={(e) => onChange(e.target.value || null)}
              className="mt-2 w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 placeholder:text-gray-300 focus:border-brand focus:outline-none"
            />
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {shownError ? <p className="mt-2 text-xs text-red-600">{shownError}</p> : null}
        {note ? <p className="mt-2 text-xs text-gray-500">{note}</p> : null}
        {limitsCache ? (
          <p className="mt-2 text-[11px] text-gray-400">
            Images are resized to fit 1600px and re-encoded before upload. Hard limits:{' '}
            {formatBytes(limitsCache.maxBytes)}, {limitsCache.maxDimension}px on the longest side.
          </p>
        ) : null}

        {browsing ? (
          uploads.length === 0 ? (
            <p className="mt-2.5 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-400">
              Nothing uploaded yet — use Upload to add the first image.
            </p>
          ) : (
            <div className="mt-2.5 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-md bg-gray-50 p-2 sm:grid-cols-4">
              {uploads.map((up) => {
                const selected = value === up.url
                return (
                  <div key={up.name} className="group relative">
                    <button
                      type="button"
                      title={up.name}
                      onClick={() => {
                        onChange(up.url)
                        setBrowsing(false)
                      }}
                      className={[
                        'block w-full overflow-hidden rounded-md border-2 transition',
                        selected ? 'border-brand' : 'border-transparent hover:border-gray-300',
                      ].join(' ')}
                    >
                      <Thumb url={up.url} alt={up.name} className="h-14 w-full" />
                    </button>
                    <button
                      type="button"
                      title="Delete from library"
                      onClick={() => remove(up.name)}
                      className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded-full bg-surface/90 text-[10px] text-red-500 shadow-sm group-hover:grid"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
            </div>
          )
        ) : null}
      </div>

      {field.hint ? <span className="mt-1 block text-[11px] text-gray-400">{field.hint}</span> : null}
    </label>
  )
}
