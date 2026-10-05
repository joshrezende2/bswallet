import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Hosted previews can retain dependencies from the original project template.
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { force: true, include: ['react', 'react-dom/client', 'react/jsx-runtime'] },
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'icon-192.svg', 'icon-512.svg'],
    manifest: {
      name: 'BS Wallet — Finanças pessoais e em família', short_name: 'BS Wallet',
      description: 'Seu controle financeiro pessoal e familiar, mesmo sem internet.',
      lang: 'pt-BR', theme_color: '#008847', background_color: '#F6FAF8',
      display: 'standalone', start_url: '/', scope: '/',
      icons: [192, 512].map(size => ({ src: `/icon-${size}.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' })),
    },
    workbox: { globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'], maximumFileSizeToCacheInBytes: 4000000,
      navigateFallbackDenylist: [/^\/api/], cleanupOutdatedCaches: true },
  })],
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
