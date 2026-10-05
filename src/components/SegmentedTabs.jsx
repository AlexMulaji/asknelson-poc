// Underlined tab strip used by My Wellness (Your Journey / Meditation).
// Controlled: the parent owns `value` so the choice can live in the URL.
// On mobile the tabs split the full width equally; the parent bleeds the strip
// to the screen edges. Desktop keeps them content-width.
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
              'relative -mb-px min-h-[44px] flex-1 px-1 pb-3 pt-1 text-center text-[15px] transition-colors',
              'lg:min-w-[130px] lg:flex-none lg:px-5',
              active
                ? 'font-extrabold text-brand lg:text-[18px]'
                : 'font-semibold text-muted hover:text-ink lg:text-[16px]',
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
