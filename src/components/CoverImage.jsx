import { useEffect, useState } from 'react'

// Shared <img> wrapper for all editorial imagery (journey covers, article
// thumbnails, meditation scenes). Images are admin-editable, so any src can go
// stale — on error this renders the neutral placeholder tint instead of a
// broken-image glyph, and callers can branch on it via `onMissing`.
//
// Loading behaviour, which is most of why the cards feel fast:
//
//   loading="lazy"   cards below the fold cost nothing until they are scrolled
//                    to. The hero passes priority, which opts out — lazy-
//                    loading the largest image on screen delays the very thing
//                    the page is judged on.
//   decoding="async" decoding a large JPEG on the main thread janks the scroll
//   width/height     an intrinsic ratio, so the card reserves its space before
//                    the bytes arrive and nothing jumps as images land
//
// The files themselves are kept small at the source: the admin editor
// downscales and re-encodes on upload (lib/imageCompression.js).

export default function CoverImage({
  src,
  alt = '',
  className = '',
  imgClassName = '',
  // Set on the one image that is largest and above the fold on a screen.
  priority = false,
  // The intrinsic ratio to reserve space with. Portrait suits the cards; pass
  // `[16, 9]`-style numbers for a wide hero.
  width = 3,
  height = 4,
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  if (!src || failed) {
    return <div aria-hidden className={`media-bg ${className}`} />
  }

  return (
    <div className={`media-bg overflow-hidden ${className}`}>
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        fetchpriority={priority ? 'high' : undefined}
        decoding="async"
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover ${imgClassName}`}
      />
    </div>
  )
}
