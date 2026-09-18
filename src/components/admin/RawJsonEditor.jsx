import { useEffect, useState } from 'react'

// Escape hatch: edit the full dataset as JSON. Changes only reach the parent
// (and thus the Save button) once they parse, via "Apply".
export default function RawJsonEditor({ doc, onChange }) {
  const [text, setText] = useState(() => JSON.stringify(doc, null, 2))
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)

  // Re-sync when the document changes from outside (structured edits, reload).
  useEffect(() => {
    setText(JSON.stringify(doc, null, 2))
    setDirty(false)
    setError(null)
  }, [doc])

  const apply = () => {
    try {
      onChange(JSON.parse(text))
      setError(null)
      setDirty(false)
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`)
    }
  }

  return (
    <div>
      <textarea
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        className="h-[60vh] w-full rounded-xl border border-gray-200 bg-surface p-4 font-mono text-xs leading-relaxed text-gray-800 focus:border-brand focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty}
          onClick={apply}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand transition disabled:opacity-40"
        >
          Apply JSON
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {dirty && !error ? (
          <p className="text-xs text-gray-400">Unapplied changes — click Apply, then Save.</p>
        ) : null}
      </div>
    </div>
  )
}
