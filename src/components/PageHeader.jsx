// Screen title row. In the V1 design this is a large navy display heading with
// an optional subtitle and an optional trailing control (usually the ⋮ menu).
// Pass `logo` (an image src) to render the brand mark in place of the text.
export default function PageHeader({ title, subtitle, logo, action, className = '' }) {
  return (
    <div
      className={[
        'flex items-start justify-between gap-3',
        // Extra top padding on iOS where the status bar sits inside the webview.
        'px-5 pt-[calc(1.5rem+env(safe-area-inset-top,0px))]',
        'lg:px-0 lg:pt-0',
        className,
      ].join(' ')}
    >
      <div className="min-w-0">
        {logo ? (
          <h1 className="leading-none">
            <img src={logo} alt={title} className="h-8 w-auto" />
          </h1>
        ) : (
          <h1 className="font-display text-[30px] font-extrabold leading-tight text-navy lg:text-[38px]">
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
