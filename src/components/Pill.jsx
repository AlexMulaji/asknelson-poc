// Small tinted label used for journey categories, explore topics and day
// activity types. Tones come from the Tailwind `pill` palette sampled off the
// mockups; unknown tones fall back to the neutral navy tint.

const TONES = {
  orange: 'bg-pill-orange text-pill-orange-fg',
  purple: 'bg-pill-purple text-pill-purple-fg',
  green: 'bg-pill-green text-pill-green-fg',
  lime: 'bg-pill-lime text-pill-lime-fg',
  red: 'bg-pill-red text-pill-red-fg',
  blue: 'bg-pill-blue text-pill-blue-fg',
  neutral: 'bg-canvas text-ink',
}

// Journey/theme categories and day types each map to a fixed tone so the same
// topic reads the same colour everywhere in the app.
const TOPIC_TONES = {
  'anxiety & stress': 'orange',
  anxiety: 'orange',
  connection: 'purple',
  loneliness: 'purple',
  relationships: 'purple',
  'work & purpose': 'red',
  burnout: 'red',
  'grief & loss': 'green',
  grief: 'green',
  sleep: 'blue',
  read: 'lime',
  watch: 'red',
  reflect: 'purple',
  practise: 'orange',
  practice: 'orange',
}

export function toneFor(label, fallback = 'neutral') {
  if (!label) return fallback
  return TOPIC_TONES[String(label).trim().toLowerCase()] ?? fallback
}

// `bg` / `fg` are optional hex overrides — Explore themes carry their own pair,
// set per topic in /admin. Either can be given on its own; whatever is missing
// keeps the tone class underneath.
export default function Pill({ children, tone, label, bg, fg, className = '' }) {
  const resolved = tone ?? toneFor(label ?? children)
  const style = bg || fg ? { backgroundColor: bg || undefined, color: fg || undefined } : undefined
  return (
    <span
      className={[
        'inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-bold leading-none',
        TONES[resolved] ?? TONES.neutral,
        className,
      ].join(' ')}
      style={style}
    >
      {children ?? label}
    </span>
  )
}
