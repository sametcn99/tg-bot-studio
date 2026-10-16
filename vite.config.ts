import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite configuration for the React 19 Studio Management Dashboard.
 * Development server runs on port 5173 and proxies API calls to the NestJS
 * backend on port 3000. Production output is emitted to `dist/client`.
 */
export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        // Route-level code splitting happens via React.lazy; these chunks
        // keep the heavyweight frameworks cacheable across lazy pages.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': [
            '@mui/material',
            '@mui/icons-material',
            '@emotion/react',
            '@emotion/styled',
          ],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
