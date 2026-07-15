import stampUrl from '../assets/confidentiality-stamp.png'

// The "Confidentiality Guaranteed" trust stamp. Rendered persistently across
// the app (sidebar on desktop, a footer on mobile) to reassure users — wherever
// they are — that the service is confidential.
export default function ConfidentialityStamp({ className = '', imgClassName = '' }) {
  return (
    <div className={className}>
      <img
        src={stampUrl}
        alt="Confidentiality Guaranteed"
        className={['h-auto w-full max-w-[180px]', imgClassName].join(' ')}
        loading="lazy"
        decoding="async"
      />
    </div>
  )
}
