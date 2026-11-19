// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language } from '@trainslator/shared';

import { useLanguages } from './languages';
import { apiFetch } from './api';

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    apiFetch: vi.fn(),
  };
});

const languages: Language[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'English',
    nativeName: 'English',
    iso6391: 'en',
    dir: 'ltr',
    isSource: true,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    name: 'Arabic',
    nativeName: 'العربية',
    iso6391: 'ar',
    dir: 'rtl',
    isSource: false,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
  },
];

function Probe() {
  const { data = [], isLoading, isError } = useLanguages();
  if (isLoading) return <p>loading</p>;
  if (isError) return <p>error</p>;
  return (
    <ul>
      {data.map((language) => (
        <li key={language.id}>{language.iso6391}</li>
      ))}
    </ul>
  );
}

function wrapper(client: QueryClient) {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useLanguages', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('walks every page until next is null and caches by key', async () => {
    const page1: KeysetList<Language> = {
      items: [languages[0] as Language],
      next: {
        lastId: '10000000-0000-4000-8000-000000000001',
        lastCreatedAt: '2026-11-18T00:00:00.000Z',
      },
    };
    const page2: KeysetList<Language> = {
      items: [languages[1] as Language],
      next: null,
    };
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(<Probe />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.queryByText('en')).toBeTruthy();
    });
    expect(screen.queryByText('ar')).toBeTruthy();
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2);
    const secondUrl = vi.mocked(apiFetch).mock.calls[1]?.[0];
    expect(secondUrl).toContain('lastId=');
  });

  it('surfaces a fetch failure as an error state', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(<Probe />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.queryByText('error')).toBeTruthy();
    });
  });
});
