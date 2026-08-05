import { useEffect, useState } from 'react'

// Shared <img> wrapper for all editorial imagery (journey covers, article
// thumbnails, meditation scenes). Images are admin-editable, so any src can go
// stale — on error this renders the neutral placeholder tint instead of a
// broken-image glyph, and callers can branch on it via `onMissing`.
export default function CoverImage({ src, alt = '', className = '', imgClassName = '' }) {
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
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover ${imgClassName}`}
      />
    </div>
  )
}
