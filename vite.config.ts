import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'favicon.ico'],
      manifest: {
        name: 'Toronto Island Ferry Tracker',
        short_name: 'Ferry Tracker',
        description: 'Real-time Toronto Island Ferry positions and schedules',
        theme_color: '#060d1a',
        background_color: '#060d1a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'en-CA',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.maptiler\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'maptiler-tiles',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Schedule JSON — cache with network update
            urlPattern: /\/schedule\.json$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'schedule-data',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 24 * 60 * 60,
              },
            },
          },
          {
            // API routes — network first, fall through to cache on failure
            urlPattern: /\/api\/(?!ais).*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-data',
              networkTimeoutSeconds: 10,
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 5 * 60, // 5 minutes
              },
            },
          },
        ],
        // Don't precache the AIS SSE endpoint
        navigateFallback: '/index.html',
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1100,
  },
  test: {
    // Only run frontend tests — server/ has its own vitest config
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  envPrefix: ['VITE_'],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
