import { useState } from 'react'

// Generic structured editor driven by a schema from schemas.js: a list of
// items (themes / journeys / assessments) with editable fields and an optional
// nested child list (tiles / days / questions). Only schema fields are shown;
// any other properties on an item pass through saves untouched.

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 ' +
  'placeholder:text-gray-300 focus:border-brand focus:outline-none'

function Field({ field, value, onChange }) {
  const common = {
    id: undefined,
    value: value ?? '',
    placeholder: field.placeholder,
  }

  let control
  if (field.type === 'textarea') {
    control = (
      <textarea
        {...common}
        rows={2}
        className={inputClass}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  } else if (field.type === 'number') {
    control = (
      <input
        {...common}
        type="number"
        className={inputClass}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    )
  } else if (field.type === 'select') {
    control = (
      <select
        value={value ?? field.options?.[0] ?? ''}
        className={inputClass}
        onChange={(e) => onChange(e.target.value)}
      >
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  } else if (field.type === 'color') {
    control = (
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value : '#888888'}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-gray-200 bg-white p-1"
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          value={value ?? ''}
          placeholder="#RRGGBB"
          className={inputClass}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )
  } else {
    control = (
      <input
        {...common}
        type="text"
        className={inputClass}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500">{field.label}</span>
      {control}
      {field.hint ? <span className="mt-1 block text-[11px] text-gray-400">{field.hint}</span> : null}
    </label>
  )
}

function FieldGrid({ fields, item, onPatch }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : undefined}>
          <Field
            field={field}
            value={item?.[field.key]}
            onChange={(v) => onPatch({ [field.key]: v })}
          />
        </div>
      ))}
    </div>
  )
}

// Reorder / delete controls shown in every item header row.
function RowControls({ index, count, onMove, onRemove, itemName }) {
  const btn =
    'grid h-7 w-7 place-items-center rounded-md border border-gray-200 text-xs text-gray-500 ' +
    'transition hover:bg-gray-50 disabled:opacity-30'
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <button type="button" title="Move up" className={btn} disabled={index === 0} onClick={() => onMove(index, -1)}>
        ↑
      </button>
      <button
        type="button"
        title="Move down"
        className={btn}
        disabled={index === count - 1}
        onClick={() => onMove(index, 1)}
      >
        ↓
      </button>
      <button
        type="button"
        title={`Delete ${itemName}`}
        className={`${btn} text-red-500 hover:bg-red-50`}
        onClick={() => {
          if (window.confirm(`Delete this ${itemName}? This can't be undone after saving.`)) onRemove(index)
        }}
      >
        ✕
      </button>
    </div>
  )
}

function moveInList(list, index, dir) {
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(index + dir, 0, item)
  return next
}

// Nested list (tiles / days / questions) inside an expanded parent item.
function ChildList({ schema, list, onChange }) {
  const [open, setOpen] = useState(() => new Set())

  const toggle = (i) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div className="mt-4 border-t border-gray-100 pt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">{schema.label}</p>
        <button
          type="button"
          className="rounded-md bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand transition hover:bg-brand/20"
          onClick={() => {
            onChange([...list, schema.newItem()])
            setOpen((prev) => new Set(prev).add(list.length))
          }}
        >
          + Add {schema.itemName}
        </button>
      </div>

      {list.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">
          No {schema.label.toLowerCase()} yet.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((child, i) => (
            <div key={i} className="rounded-lg border border-gray-100 bg-gray-50/60">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                onClick={() => toggle(i)}
              >
                <span className="truncate text-sm font-medium text-gray-700">
                  {schema.itemLabel(child)}
                </span>
                <RowControls
                  index={i}
                  count={list.length}
                  itemName={schema.itemName}
                  onMove={(idx, dir) => onChange(moveInList(list, idx, dir))}
                  onRemove={(idx) => onChange(list.filter((_, j) => j !== idx))}
                />
              </button>
              {open.has(i) ? (
                <div className="border-t border-gray-100 px-3 py-3">
                  <FieldGrid
                    fields={schema.fields}
                    item={child}
                    onPatch={(patch) =>
                      onChange(list.map((c, j) => (j === i ? { ...c, ...patch } : c)))
                    }
                  />
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CollectionEditor({ schema, doc, onChange }) {
  const list = schema.getList(doc)
  const [open, setOpen] = useState(() => new Set())

  const setList = (next) => onChange(schema.setList(doc, next))
  const toggle = (i) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div>
      {schema.advancedNote ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
          {schema.advancedNote}
        </p>
      ) : null}

      <div className="space-y-3">
        {list.map((item, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              onClick={() => toggle(i)}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
                  style={{ background: item?.color || '#ccc' }}
                  aria-hidden
                />
                <span className="truncate text-[15px] font-semibold text-gray-800">
                  {schema.itemLabel(item)}
                </span>
              </span>
              <RowControls
                index={i}
                count={list.length}
                itemName={schema.itemName}
                onMove={(idx, dir) => setList(moveInList(list, idx, dir))}
                onRemove={(idx) => setList(list.filter((_, j) => j !== idx))}
              />
            </button>

            {open.has(i) ? (
              <div className="border-t border-gray-100 px-4 py-4">
                <FieldGrid
                  fields={schema.fields}
                  item={item}
                  onPatch={(patch) => setList(list.map((it, j) => (j === i ? { ...it, ...patch } : it)))}
                />
                {schema.children ? (
                  <ChildList
                    schema={schema.children}
                    list={item?.[schema.children.key] ?? []}
                    onChange={(childList) =>
                      setList(
                        list.map((it, j) =>
                          j === i ? { ...it, [schema.children.key]: childList } : it
                        )
                      )
                    }
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <button
        type="button"
        className="mt-4 w-full rounded-xl border border-dashed border-gray-300 py-3 text-sm font-semibold text-gray-500 transition hover:border-brand hover:text-brand"
        onClick={() => {
          setList([...list, schema.newItem()])
          setOpen((prev) => new Set(prev).add(list.length))
        }}
      >
        + Add {schema.itemName}
      </button>
    </div>
  )
}
