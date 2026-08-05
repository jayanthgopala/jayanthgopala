import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A production build without VITE_API_URL used to fall back to a hardcoded
 * Worker URL, which meant every fork shipped a bundle pointing at the original
 * author's API. Failing here surfaces it in the build log, where it is one line
 * to fix, instead of as a blank page after deploy.
 *
 * `npm run setup` writes .env for you; on Pages, set it on the project.
 */
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
  };
});
