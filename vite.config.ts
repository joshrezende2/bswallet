import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const packageVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(packageVersion) },
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
    workbox: {
      globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      globIgnores: ['**/exceljs*.js', '**/jspdf*.js', '**/html2canvas*.js', '**/purify*.js', '**/jspdf.plugin.autotable*.js'],
      maximumFileSizeToCacheInBytes: 4000000,
      navigateFallbackDenylist: [/^\/api/],
      cleanupOutdatedCaches: true,
      runtimeCaching: [{
        urlPattern: /\/assets\/(?:exceljs|jspdf|html2canvas|purify|jspdf\.plugin\.autotable)-.*\.js$/,
        handler: 'CacheFirst',
        options: { cacheName: 'bs-wallet-export-tools', expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 } },
      }],
    },
  })],
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]react(?:-dom|-router-dom)?[\\/]/.test(id)) return 'react-vendor';
          if (id.includes('dexie')) return 'local-database';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('zod')) return 'validation';
          return undefined;
        },
      },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
