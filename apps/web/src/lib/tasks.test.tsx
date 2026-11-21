// @vitest-environment jsdom
import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from './api';
import { useAiTasks } from './tasks';

vi.mock('./api', () => ({ apiFetch: vi.fn() }));

const descriptor = {
  description: 'Translate text into a target language.',
  label: 'Translate',
  model: 'bonsai-2:2b',
  provider: 'ollama',
  task: 'translate',
};

/**
 * Provides a fresh query client to each hook render.
 * @param props - the wrapper properties
 * @param props.children - the child tree
 * @returns the provider element
 */
function wrapper(props: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>;
}

describe('useAiTasks', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('returns validated descriptors from the API', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ items: [descriptor] }));
    const { result } = renderHook(() => useAiTasks(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([descriptor]));
  });

  it('drops invalid descriptors and falls back when none remain', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => ({ items: [{ task: 'unknown' }] }));
    const { result } = renderHook(() => useAiTasks(), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(7));
  });

  it('falls back when the endpoint rejects', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => {
      throw new Error('offline');
    });
    const { result } = renderHook(() => useAiTasks(), { wrapper });
    await waitFor(() => expect(result.current.data?.length).toBe(7));
  });
});
