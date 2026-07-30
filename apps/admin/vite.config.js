import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // See apps/web/vite.config.js — same reason: Pages installs inside this
      // directory, so the shared tokens have to resolve by path, not workspace.
      '@portfolio/tokens': fileURLToPath(new URL('../../packages/tokens', import.meta.url)),
    },
  },
  server: {
    // Different port from the website so both can run at once in dev.
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/media': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: { target: 'es2022', cssCodeSplit: false, reportCompressedSize: false },
});
