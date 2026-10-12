import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration for the Telegram Mini App (TMA) webview shell.
 * Development server runs on port 5174 under the `/tma` base path and proxies
 * API calls to the NestJS backend on port 3000. Production output is emitted
 * to `dist/client-tma` and served by NestJS under `/tma/*`.
 */
export default defineConfig({
  root: 'src/client-tma',
  base: '/tma/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../dist/client-tma',
    emptyOutDir: true,
    sourcemap: false,
  },
});
