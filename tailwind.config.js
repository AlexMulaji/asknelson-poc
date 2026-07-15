/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Placeholder brand colours — replace with real hex values when assets arrive.
        brand: {
          DEFAULT: '#172B5C', // primary navy
          dark: '#172B5C',
          green: '#4CB03F', // primary green
        },
        muted: '#9AA0A6',
        // Soft off-white app canvas so white cards gain depth (less clinical).
        canvas: '#F6F7FB',
      },
      fontFamily: {
        // Plus Jakarta Sans throughout — geometric, friendly, modern.
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        // Headings use the same family; heavier weights carry the personality.
        display: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '20px',
        btn: '14px',
        hero: '28px',
      },
      boxShadow: {
        // Soft, layered elevation — replaces flat hairline borders.
        soft: '0 1px 2px rgb(16 24 40 / 0.04), 0 1px 3px rgb(16 24 40 / 0.06)',
        card: '0 2px 8px -2px rgb(16 24 40 / 0.06), 0 12px 28px -12px rgb(16 24 40 / 0.12)',
        lift: '0 10px 34px -10px rgb(16 24 40 / 0.20)',
      },
    },
  },
  plugins: [],
}
