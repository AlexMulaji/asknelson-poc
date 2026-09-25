import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'AskNelson',
        short_name: 'AskNelson',
        description: 'Real support from real people. Content and wellness for your everyday.',
        theme_color: '#172B5C',
        background_color: '#F6F7FB',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache all built static assets plus JSON data for offline use.
        // Audio (.mp3) is intentionally excluded from precaching — the files are
        // large (multiple MB each) and would bloat the install. They're cached
        // on first play instead, via the CacheFirst runtimeCaching rule below.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,woff,woff2}'],
        // Never serve index.html for API calls, admin-uploaded media, or
        // anything that looks like a file (e.g. the policy PDFs in /public).
        // Without the last rule, opening /Kaelo_Cookie_Policy.pdf boots the
        // app instead, and the auth guard bounces it to /login. Workbox tests
        // pathname + search, so the dot must come before any "?".
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^[^?]*\.[a-z0-9]+(\?.*)?$/i],
        runtimeCaching: [
          {
            // Editorial imagery: the seed photography in /media plus anything
            // uploaded through /admin. Both are content-addressed or stable, so
            // cache-first keeps covers available offline.
            urlPattern: /\/(uploads|media)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'asknelson-media',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Editable content from the backend: prefer the network so admin
            // edits show up immediately, fall back to cache when offline.
            urlPattern: /\/api\/content\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'asknelson-content',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 10 },
            },
          },
          {
            urlPattern: ({ request }) =>
              request.destination === 'audio' || request.url.endsWith('.mp3'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'asknelson-audio',
              expiration: { maxEntries: 10 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    // In dev, run the content API alongside vite: `npm run serve` (port 8080).
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
})
