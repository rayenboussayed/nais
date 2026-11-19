import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Proxy target for /api and /socket.io. Local dev talks to localhost:3000;
// the docker dev stack sets VITE_API_PROXY_TARGET=http://api:3000.
// eslint-disable-next-line deslint/no-hardcoded-localhost -- documented local-dev proxy default; overridden by VITE_API_PROXY_TARGET
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  build: {
    outDir: 'dist',
    // Sentry-style sourcemaps are not published; the deploy serves dist/ as-is.
    sourcemap: false,
  },
  plugins: [
    TanStackRouterVite({
      generatedRouteTree: './src/routeTree.gen.ts',
      routesDirectory: './src/routes',
    }),
    react(),
  ],
  server: {
    port: 4173,
    proxy: {
      '/api': {
        changeOrigin: false,
        target: apiProxyTarget,
      },
      '/socket.io': {
        changeOrigin: false,
        target: apiProxyTarget,
        ws: true,
      },
    },
  },
});
