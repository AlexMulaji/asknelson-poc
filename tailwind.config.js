/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Sampled from the V1 Figma mockups (see README "Design tokens").
        brand: {
          DEFAULT: '#89BA16', // primary green — CTAs, active nav, accents
          dark: '#78A417', // pressed / hover state
          tint: '#EDF4DC', // active nav pill, icon chips
          wash: '#F9FBF4', // privacy band, active day card
        },
        navy: {
          DEFAULT: '#01243B', // headings, dark hero cards, active filter chip
          soft: '#12384F', // gradient partner for the dark hero
        },
        // Assessments run on orange; the SOS action runs on red.
        accent: '#FF751C',
        danger: '#E1231F',
        muted: '#93A1AA', // inactive nav labels, meta text
        line: '#E6EBED', // hairline borders
        canvas: '#F4F6F7', // app background behind white cards
        // Category / activity pills. Each is a tinted background + a readable
        // foreground at the same hue.
        pill: {
          orange: '#FFEADD',
          'orange-fg': '#C4551A',
          purple: '#EBE2F1',
          'purple-fg': '#6B4A8A',
          green: '#E2EFE1',
          'green-fg': '#3D7A3F',
          lime: '#E8F1D3',
          'lime-fg': '#5E7F14',
          red: '#FCE9E9',
          'red-fg': '#B33A36',
          blue: '#DDEBF5',
          'blue-fg': '#2F6288',
        },
      },
      fontFamily: {
        sans: ['Nunito', 'system-ui', 'sans-serif'],
        display: ['Nunito', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '16px',
        btn: '12px',
        hero: '20px',
        pill: '999px',
      },
      boxShadow: {
        soft: '0 1px 2px rgb(1 36 59 / 0.04), 0 1px 3px rgb(1 36 59 / 0.06)',
        card: '0 1px 2px rgb(1 36 59 / 0.04), 0 6px 20px -8px rgb(1 36 59 / 0.10)',
        lift: '0 10px 34px -10px rgb(1 36 59 / 0.20)',
      },
      maxWidth: {
        content: '1120px', // desktop content column beside the 320px sidebar
      },
    },
  },
  plugins: [],
}
