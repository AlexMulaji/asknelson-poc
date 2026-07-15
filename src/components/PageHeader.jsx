// Sticky page header — stays visible as the user scrolls, with a frosted
// background so content doesn't collide with the title.
// Pass `logo` (an image src) to render the brand logo in place of the text title.
export default function PageHeader({ title, subtitle, logo }) {
  return (
    <header
      className={[
        'sticky top-0 z-30 px-5 pb-3',
        // Extra top padding on iOS where the status bar sits inside the webview.
        'pt-[calc(1.5rem+env(safe-area-inset-top,0px))]',
        // Frosted-glass feel that matches the bottom nav.
        'bg-white/92 backdrop-blur-md',
        // Hairline separator that appears once content scrolls under the header.
        'border-b border-transparent',
        // JS-free trick: the border becomes visible when the header is stuck.
        // We achieve this with a box-shadow instead — softer than a hard border.
        '[box-shadow:0_1px_0_0_rgb(0_0_0/0.06)]',
      ].join(' ')}
    >
      {logo ? (
        <h1 className="leading-none">
          <img src={logo} alt={title} className="h-8 w-auto" />
        </h1>
      ) : (
        <h1 className="font-display text-[26px] font-semibold leading-tight text-black">{title}</h1>
      )}
      {subtitle ? (
        <p className="mt-0.5 text-[13px] leading-snug text-gray-500">{subtitle}</p>
      ) : null}
    </header>
  )
}
