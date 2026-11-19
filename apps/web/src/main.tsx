import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { routeTree } from './routeTree.gen';
import './styles/styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const router = createRouter({ context: { queryClient }, routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('missing #root element');
}

// Telemetry is build-time opt-in: without VITE_OTEL_ENDPOINT nothing is
// loaded or registered (Vite dead-code-eliminates the branch; the OTEL chunk
// is never fetched). See src/lib/telemetry.ts.
if (import.meta.env.VITE_OTEL_ENDPOINT) {
  const { startTelemetry } = await import('./lib/telemetry');
  startTelemetry();
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
