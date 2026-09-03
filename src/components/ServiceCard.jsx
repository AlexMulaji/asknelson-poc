// A booking service tile (Counsellor, Life Coach, etc.) for AskNelson.
export default function ServiceCard({ title, description, href, Icon, className = '' }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        'card-press flex h-full w-full flex-col rounded-card border border-line bg-white p-5',
        className,
      ].join(' ')}
    >
      <span className="grid h-11 w-11 place-items-center rounded-btn bg-brand-tint text-brand">
        <Icon className="h-6 w-6" />
      </span>
      <h3 className="mt-4 font-display text-[17px] font-extrabold leading-snug text-navy">
        {title}
      </h3>
      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-slate-500">{description}</p>
      <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-extrabold text-brand">
        Book a Session <span aria-hidden>→</span>
      </span>
    </a>
  )
}
