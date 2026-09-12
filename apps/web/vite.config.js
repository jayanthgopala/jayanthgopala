import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Ensure VITE_API_URL is configured for production builds
function requireApiUrl(mode, env) {
  if (mode !== 'production') return;
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
    // Deduplicate shared packages across workspace to prevent runtime issues
    dedupe: ['three', 'react', 'react-dom', '@react-three/fiber'],
    alias: {
      // Shared design tokens package alias
      '@portfolio/tokens': fileURLToPath(new URL('../../packages/tokens', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Proxy local dev requests to the Worker API
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
