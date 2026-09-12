import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Validates VITE_API_URL is configured for production builds.
export function requireApiUrl(mode) {
  if (mode !== 'production') return; // dev proxies to a local Worker
  if (String(process.env.VITE_API_URL || '').trim()) return;
  throw new Error(
    [
      '',
      'VITE_API_URL is not set — this build would have no API to talk to.',
      '',
      '  local       run `npm run setup`, or add VITE_API_URL to .env',
      '  Cloudflare  set it in the Pages project environment variables',
      '',
      'Include the scheme: https://your-worker.workers.dev',
      '',
    ].join('\n')
  );
}

export default defineConfig(({ mode }) => {
  requireApiUrl(mode);
  return {
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve shared tokens package path directly.
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
  };
});
