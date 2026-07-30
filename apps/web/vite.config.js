import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Path alias rather than an npm workspace dependency. Cloudflare Pages
      // runs `npm install` inside this app's root directory, where a workspace
      // protocol dep can't resolve — it goes looking on the registry and the
      // build dies. An alias keeps the shared tokens working in both.
      '@portfolio/tokens': fileURLToPath(new URL('../../packages/tokens', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Proxy in dev so the browser sees a same-origin API and cookies/CORS
    // behave exactly as they do in production.
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/media': { target: 'http://localhost:8787', changeOrigin: true },
      '/svg': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
