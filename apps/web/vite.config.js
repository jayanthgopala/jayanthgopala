import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
