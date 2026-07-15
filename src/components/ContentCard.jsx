import { ExternalLinkIcon } from './Icons.jsx'

// Renders one Explore item (article or video).
// Items are enriched in Explore.jsx with theme label/colour + a duration string.
export default function ContentCard({ item }) {
  const accent = item.themeColor || '#172B5C'
  const isVideo = (item.type || '').toLowerCase() === 'video'
  const typeLabel = isVideo ? 'Video' : 'Article'

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      // card-press gives a physical scale-down on tap (defined in index.css).
      className="card-press block overflow-hidden rounded-card bg-white shadow-card"
    >
      <div className="flex">
        {/* Left theme-colour accent bar */}
        <span aria-hidden className="w-1.5 shrink-0" style={{ backgroundColor: accent }} />
        <div className="flex-1 px-4 py-4">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: isVideo ? '#172B5C' : '#4CB03F' }}
            >
              {typeLabel}
            </span>
            {item.theme ? (
              <span className="text-[11px] font-medium" style={{ color: accent }}>
                {item.theme}
              </span>
            ) : null}
          </div>

          <h3 className="mt-2 font-display text-[16px] font-semibold leading-snug text-black">
            {item.title}
          </h3>

          {item.description ? (
            <p className="mt-1 text-[13px] leading-relaxed text-gray-500">{item.description}</p>
          ) : null}

          <div className="mt-2.5 flex items-center justify-between text-[12px] text-gray-400">
            <span className="truncate">
              {item.source}
              {item.source && item.duration ? ' · ' : ''}
              {item.duration}
            </span>
            <ExternalLinkIcon className="h-4 w-4 shrink-0 text-gray-300" />
          </div>
        </div>
      </div>
    </a>
  )
}
