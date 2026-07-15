// A booking service tile (Counsellor, Life Coach, etc.) for AskNelson.
export default function ServiceCard({ title, description, href, Icon, color = '#172B5C', className = '' }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={['card-press flex h-full w-full flex-col rounded-card bg-white p-4 shadow-card', className].join(' ')}
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-btn"
        style={{ backgroundColor: `${color}14`, color }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-3 font-display text-[15px] font-semibold leading-snug text-black">{title}</h3>
      <p className="mt-1 flex-1 text-[12px] leading-relaxed text-gray-500">{description}</p>
      <span className="mt-3 text-[12px] font-semibold" style={{ color }}>
        Book now →
      </span>
    </a>
  )
}
