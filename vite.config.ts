import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    injectRegister: 'script-defer',
    includeAssets: ['icons/*.png', 'icons/pad.svg'],
    manifest: {
      id: '/',
      name: 'pad',
      short_name: 'pad',
      description: 'Your personal live text pad.',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      background_color: '#3c3c3c',
      theme_color: '#3c3c3c',
      icons: [
        { src: '/icons/pad-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/pad-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/pad-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html}'],
      navigateFallback: '/index.html',
      cleanupOutdatedCaches: true,
      runtimeCaching: [{
        urlPattern: /^https:\/\/[^/]+\.supabase\.co\//,
        handler: 'NetworkOnly',
      }],
    },
  })],
})
