// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createRoot, createRouter, render, RouterProvider, startTelemetry } = vi.hoisted(() => {
  const render = vi.fn<(node: ReactNode) => void>();
  return {
    createRoot: vi.fn(() => ({ render })),
    createRouter: vi.fn(() => ({ id: 'test-router' })),
    render,
    RouterProvider: vi.fn(() => null),
    startTelemetry: vi.fn(),
  };
});

vi.mock('react-dom/client', () => ({ createRoot }));
vi.mock('@tanstack/react-router', () => ({ createRouter, RouterProvider }));
vi.mock('./routeTree.gen', () => ({ routeTree: { id: 'test-tree' } }));
vi.mock('./lib/telemetry', () => ({ startTelemetry }));

describe('main.tsx bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mounts the app into #root and leaves telemetry off by default', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', '');
    document.body.innerHTML = '<div id="root"></div>';
    const container = document.getElementById('root');

    await import('./main');

    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(createRoot).toHaveBeenCalledWith(container);
    expect(render).toHaveBeenCalledTimes(1);
    const tree = render.mock.calls[0]?.[0];
    expect(tree).toMatchObject({ type: StrictMode });
    expect(createRouter).toHaveBeenCalledWith({
      context: { queryClient: expect.any(QueryClient) },
      routeTree: { id: 'test-tree' },
    });
    expect(startTelemetry).not.toHaveBeenCalled();
  });

  it('starts telemetry when VITE_OTEL_ENDPOINT is set at build time', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', 'https://collector.internal:4318');
    document.body.innerHTML = '<div id="root"></div>';

    await import('./main');

    expect(startTelemetry).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('fails fast when the #root element is missing', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', '');

    await expect(import('./main')).rejects.toThrow('missing #root element');
    expect(render).not.toHaveBeenCalled();
    expect(startTelemetry).not.toHaveBeenCalled();
  });
});
