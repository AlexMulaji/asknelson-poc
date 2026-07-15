// Small helpers for deriving soft tints and gradients from a topic's hex colour,
// so each theme/assessment/journey carries its own warm identity (lever 2).

/** Parse a #rgb or #rrggbb hex into { r, g, b }. Falls back to brand navy. */
function parseHex(hex) {
  let h = (hex || '').replace('#', '').trim()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) h = '172B5C'
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

/** rgba() string from a hex + alpha (0–1). */
export function withAlpha(hex, alpha = 1) {
  const { r, g, b } = parseHex(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** A gentle diagonal wash — good for card backgrounds and small accents. */
export function softGradient(hex) {
  return `linear-gradient(135deg, ${withAlpha(hex, 0.16)} 0%, ${withAlpha(hex, 0.05)} 100%)`
}

/**
 * A soft multi-point "mesh" gradient hero. Layered radial blooms in the topic
 * colour over a near-white base — the warm, modern hero look (lever 2).
 */
export function meshGradient(hex) {
  return [
    `radial-gradient(120% 120% at 0% 0%, ${withAlpha(hex, 0.22)} 0%, ${withAlpha(hex, 0)} 55%)`,
    `radial-gradient(120% 120% at 100% 0%, ${withAlpha(hex, 0.14)} 0%, ${withAlpha(hex, 0)} 50%)`,
    `linear-gradient(180deg, ${withAlpha(hex, 0.08)} 0%, ${withAlpha(hex, 0.02)} 100%)`,
  ].join(', ')
}
