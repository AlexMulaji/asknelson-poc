/** @type {import('tailwindcss').Config} */

// Every colour is a CSS variable holding an "R G B" triple, resolved through
// rgb(... / <alpha-value>) so Tailwind's opacity modifiers (bg-surface/80)
// still work. The triples are defined twice in index.css -- once on :root and
// once under .dark -- which is what makes the whole app switch theme without a
// single dark: variant in a component.
//
// The neutral ramp is deliberately shared by `gray` and `slate`. The member
// app reached for slate-* and the admin portal for gray-*, and keeping two
// near-identical ramps would have meant maintaining two dark palettes that
// have to stay in step. Both now resolve to one set of tokens (Tailwind's
// slate values in light mode), so existing markup keeps working unchanged.
const ramp = (name) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
      step,
      `rgb(var(--${name}-${step}) / <alpha-value>)`,
    ])
  )

const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Driven by a class on <html>, not the media query, because the member can
  // override the system setting (see lib/theme.js).
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Sampled from the V1 Figma mockups (see README "Design tokens").
        brand: {
          DEFAULT: token('brand'), // primary green — CTAs, active nav, accents
          dark: token('brand-dark'), // pressed / hover state
          tint: token('brand-tint'), // active nav pill, icon chips
          wash: token('brand-wash'), // privacy band, active day card
        },
        navy: {
          DEFAULT: token('navy'), // headings, dark hero cards, active filter chip
          soft: token('navy-soft'), // gradient partner for the dark hero
        },
        // Assessments run on orange; the SOS action runs on red.
        accent: token('accent'),
        danger: token('danger'),
        muted: token('muted'), // inactive nav labels, meta text
        line: token('line'), // hairline borders
        canvas: token('canvas'), // app background behind raised cards

        // Semantic surfaces and text. `surface` is what used to be bg-white:
        // the raised card colour, which is white in light mode and a lifted
        // slate in dark. `on-brand` is the label colour that sits on a brand
        // fill -- white on the darker light-mode green, near-black on the
        // brighter dark-mode green, which is the only way that button stays
        // legible in both.
        surface: {
          DEFAULT: token('surface'),
          sunken: token('surface-sunken'),
        },
        ink: {
          DEFAULT: token('ink'),
          soft: token('ink-soft'),
          faint: token('ink-faint'),
        },
        'on-brand': token('on-brand'),

        // Category / activity pills. Each is a tinted background + a readable
        // foreground at the same hue.
        pill: {
          orange: token('pill-orange'),
          'orange-fg': token('pill-orange-fg'),
          purple: token('pill-purple'),
          'purple-fg': token('pill-purple-fg'),
          green: token('pill-green'),
          'green-fg': token('pill-green-fg'),
          lime: token('pill-lime'),
          'lime-fg': token('pill-lime-fg'),
          red: token('pill-red'),
          'red-fg': token('pill-red-fg'),
          blue: token('pill-blue'),
          'blue-fg': token('pill-blue-fg'),
        },

        gray: ramp('n'),
        slate: ramp('n'),
        // Status hues, themed for the same reason (see index.css).
        red: ramp('red'),
        amber: ramp('amber'),
        green: ramp('green'),
      },
      fontFamily: {
        sans: ['Hurme Geometric Sans 4', 'system-ui', 'sans-serif'],
        display: ['Hurme Geometric Sans 4', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        btn: '12px',
        hero: '20px',
        pill: '999px',
      },
      // Shadow alone is nearly invisible against a dark canvas, so the dark
      // theme leans on --surface sitting above --canvas for separation and
      // these only have to carry their weight in light mode.
      boxShadow: {
        soft: '0 1px 2px rgb(var(--shadow) / 0.04), 0 1px 3px rgb(var(--shadow) / 0.06)',
        card: '0 1px 2px rgb(var(--shadow) / 0.04), 0 6px 20px -8px rgb(var(--shadow) / 0.10)',
        lift: '0 10px 34px -10px rgb(var(--shadow) / 0.20)',
      },
      maxWidth: {
        content: '1120px', // desktop content column beside the 320px sidebar
      },
    },
  },
  plugins: [],
}
