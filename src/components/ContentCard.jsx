import CoverImage from './CoverImage.jsx'
import Pill from './Pill.jsx'
import { BookIcon, ClockIcon, ExternalLinkIcon, VideoIcon } from './Icons.jsx'
import { track } from '../lib/analytics.js'

// Renders one Explore item (article or video): a portrait thumbnail on the
// left, the topic pill and copy on the right, and a meta row giving the time
// cost and publisher.
// Items are enriched in Explore.jsx with theme label/colour + a duration string.
export default function ContentCard({ item }) {
  const isVideo = (item.type || '').toLowerCase() === 'video'

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      
      // card-press gives a physical scale-down on tap (defined in index.css).
      className="card-press flex overflow-hidden rounded-card bg-white shadow-card"
    >
      <CoverImage src={item.image} alt="" className="w-[104px] shrink-0 self-stretch sm:w-[116px]" />

      <div className="flex min-w-0 flex-1 flex-col px-4 py-4">
        {item.theme ? (
          <Pill
            label={item.theme}
            bg={item.themePillBg}
            fg={item.themePillFg}
            className="self-start"
          />
        ) : null}

        <h3 className="mt-2 font-display text-[17px] font-extrabold leading-snug text-navy">
          {item.title}
        </h3>

        {item.description ? (
          <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-slate-500">
            {item.description}
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-4 text-[12px] font-bold text-slate-400">
          {item.duration ? (
            <span className="inline-flex items-center gap-1.5">
              {isVideo ? (
                <VideoIcon className="h-4 w-4" strokeWidth={2} />
              ) : (
                <ClockIcon className="h-4 w-4" strokeWidth={2} />
              )}
              {item.duration}
            </span>
          ) : null}
          {item.source ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <BookIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="truncate">{item.source}</span>
            </span>
          ) : null}
          <ExternalLinkIcon className="ml-auto h-4 w-4 shrink-0 text-slate-300" />
        </div>
      </div>
    </a>
  )
}
