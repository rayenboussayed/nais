// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiTaskDescriptor, KeysetList, Language } from '../lib/types';

import { apiFetch } from '../lib/api';
import { useAiTasks } from '../lib/tasks';
import { Studio } from './studio';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

vi.mock('../lib/tasks', () => ({ useAiTasks: vi.fn() }));

const languages: Language[] = [
  {
    createdAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
    dir: 'ltr',
    id: '10000000-0000-4000-8000-000000000001',
    iso6391: 'en',
    isSource: true,
    name: 'English',
    nativeName: 'English',
    updatedAt: '2026-11-18T00:00:00.000Z',
  },
];

/**
 * Test wrapper: renders children under a throwaway QueryClient.
 * @returns the wrapper component
 */
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('Studio task fallback', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({
      items: languages,
      next: null,
    } as KeysetList<Language> as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the translate task when the registry entry has no task id', async () => {
    // A malformed descriptor reaches the component only when the registry is
    // stubbed directly; the component must still fall back to 'translate'.
    const malformed = [
      { label: 'Unknown', model: 'unknown', provider: 'ollama' },
    ] as unknown as AiTaskDescriptor[];
    vi.mocked(useAiTasks).mockReturnValue({ data: malformed } as never);

    render(<Studio />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByLabelText('Text')).toBeTruthy();
    });
    expect(screen.getByRole('option', { name: 'Unknown' })).toBeTruthy();
  });
});
