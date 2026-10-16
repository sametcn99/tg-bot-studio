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
        // Function form is required by Vite 8 (rolldown); object form is rejected.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
              id,
            )
          ) {
            return 'vendor-react';
          }
          if (/[\\/]node_modules[\\/](@mui|@emotion)[\\/]/.test(id)) return 'vendor-mui';
          if (/[\\/]node_modules[\\/](i18next|react-i18next)[\\/]/.test(id)) return 'vendor-i18n';
          return undefined;
        },
      },
    },
  },
});
