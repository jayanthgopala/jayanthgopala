import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * A production build without VITE_API_URL used to fall back to a hardcoded
 * Worker URL, which meant every fork shipped a bundle pointing at the original
 * author's API. It worked locally — the preview port is on that account's
 * allow-list — and then failed in production with an opaque CORS error.
 *
 * Failing here surfaces it in the build log, where it is one line to fix.
 * `npm run setup` writes .env for you; on Pages, set it on the project.
 */
function requireApiUrl(mode, env) {
  if (mode !== 'production') return; // dev proxies to a local Worker
  if (String(process.env.VITE_API_URL || env?.VITE_API_URL || '').trim()) return;
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
  const env = loadEnv(mode, process.cwd(), '');
  requireApiUrl(mode, env);
  return {
  plugins: [react()],
  resolve: {
    /*
     * One copy of each of these, always.
     *
     * This is a workspace, so dependencies hoist to the repo root while some
     * resolve from the app — and react-three-fiber and drei each declare three
     * and react as peers. When two copies end up in the graph the failure is
     * spectacularly unhelpful: three prints "Multiple instances of Three.js
     * being imported" and instanceof checks silently start returning false,
     * while a second React throws "Cannot read properties of null (reading
     * 'useMemo')" from inside R3F's Canvas, because the copy R3F imported has a
     * null hook dispatcher.
     *
     * Neither message points at the real cause, so this is here permanently
     * rather than as a fix for one bad afternoon.
     */
    dedupe: ['three', 'react', 'react-dom', '@react-three/fiber'],
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
  };
});
