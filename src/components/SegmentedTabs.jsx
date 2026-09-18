// Underlined tab strip used by My Wellness (Your Journey / Meditation).
// Controlled: the parent owns `value` so the choice can live in the URL.
export default function SegmentedTabs({ tabs, value, onChange }) {
  return (
    <div role="tablist" className="flex border-b border-line">
      {tabs.map(({ id, label }) => {
        const active = id === value
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={[
              'relative -mb-px min-h-[44px] px-1 pb-3 pt-1 text-[16px] transition-colors',
              'mr-8 last:mr-0',
              active ? 'font-extrabold text-brand' : 'font-semibold text-muted hover:text-ink',
            ].join(' ')}
          >
            {label}
            <span
              aria-hidden
              className={[
                'absolute inset-x-0 -bottom-px h-[3px] rounded-full transition-opacity',
                active ? 'bg-brand opacity-100' : 'opacity-0',
              ].join(' ')}
            />
          </button>
        )
      })}
    </div>
  )
}
