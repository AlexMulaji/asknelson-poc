// Screen title row. In the V1 design this is a large navy display heading with
// an optional subtitle and an optional trailing control (usually the ⋮ menu).
// Pass `logo` (an image src) to render the brand mark in place of the text.
export default function PageHeader({ title, subtitle, logo, action, className = '' }) {
  return (
    <div
      className={[
        'flex items-start justify-between gap-3',
        // No side padding of its own: every page already pads its column, and
        // a px-5 here could not be undone by a caller's px-0 (Tailwind emits
        // .px-5 after .px-0, so it always won) -- which double-indented titles.
        // Extra top padding on iOS where the status bar sits inside the webview.
        'pt-[calc(1.5rem+env(safe-area-inset-top,0px))]',
        'lg:pt-0',
        className,
      ].join(' ')}
    >
      <div className="min-w-0">
        {logo ? (
          <h1 className="leading-none">
            <img src={logo} alt={title} className="h-8 w-auto" />
          </h1>
        ) : (
          <h1 className="font-display text-[32px] font-extrabold leading-tight text-ink lg:text-[38px]">
            {title}
          </h1>
        )}
        {subtitle ? (
          <p className="mt-1 text-[14px] leading-relaxed text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 pt-1">{action}</div> : null}
    </div>
  )
}
