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
  neutral: 'bg-surface-sunken text-ink',
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
//
// Editors pick those colours for a light page, so in dark mode a pill with a
// custom `fg` follows the design's dark rule instead: the hue at 30% over
// whatever it sits on. Browsers without color-mix() drop that declaration and
// keep the light pair.
//
// An overridden half replaces the tone's class rather than sitting beside it:
// two bg-* utilities on one element resolve by stylesheet order, not class
// order, so there'd be no telling which won. (dark: variants are always
// emitted after base utilities, so the dark override is safe to add.)
const CUSTOM_DARK_BG = 'dark:bg-[color-mix(in_srgb,var(--pill-fg)_30%,transparent)]'

export default function Pill({ children, tone, label, bg, fg, className = '' }) {
  const resolved = tone ?? toneFor(label ?? children)
  const [toneBg, toneFg] = (TONES[resolved] ?? TONES.neutral).split(' ')
  const style = bg || fg ? { '--pill-bg': bg || undefined, '--pill-fg': fg || undefined } : undefined
  return (
    <span
      className={[
        'inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-bold leading-none',
        bg ? 'bg-[var(--pill-bg)]' : toneBg,
        fg ? `text-[var(--pill-fg)] ${CUSTOM_DARK_BG}` : toneFg,
        className,
      ].join(' ')}
      style={style}
    >
      {children ?? label}
    </span>
  )
}
