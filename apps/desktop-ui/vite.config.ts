import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies /api to the local agent so the browser only ever talks
// to one origin. WIGGLE_ORIGIN overrides the target when the server runs elsewhere.
const target = process.env.WIGGLE_ORIGIN || 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
    proxy: {
      '/api': { target, changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
