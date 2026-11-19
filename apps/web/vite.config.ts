import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

// Proxy target for /api and /socket.io. Local dev talks to localhost:3000;
// the docker dev stack sets VITE_API_PROXY_TARGET=http://api:3000.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
  ],
  server: {
    port: 4173,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: false,
      },
      '/socket.io': {
        target: apiProxyTarget,
        ws: true,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Sentry-style sourcemaps are not published; the deploy serves dist/ as-is.
    sourcemap: false,
  },
});
