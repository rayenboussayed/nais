// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language } from './types';

import { apiFetch } from './api';
import { useInvalidateLanguages, useLanguages } from './languages';

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    apiFetch: vi.fn(),
  };
});

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
  {
    createdAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
    dir: 'rtl',
    id: '10000000-0000-4000-8000-000000000002',
    iso6391: 'ar',
    isSource: false,
    name: 'Arabic',
    nativeName: 'العربية',
    updatedAt: '2026-11-18T00:00:00.000Z',
  },
];

/**
 * Probe exposing the catalogue and a control that invalidates its cache.
 * @returns the probe element
 */
function InvalidateProbe() {
  const { data = [], isLoading } = useLanguages();
  const invalidateLanguages = useInvalidateLanguages();
  if (isLoading) return <p>loading</p>;
  return (
    <div>
      <button onClick={() => void invalidateLanguages()} type="button">
        Invalidate
      </button>
      <ul>
        {data.map((language) => (
          <li key={language.id}>{language.iso6391}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Probe component rendering the loaded languages.
 * @returns the probe element
 */
function Probe() {
  const { data = [], isError, isLoading } = useLanguages();
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

/**
 * Test wrapper bound to a specific QueryClient.
 * @param client - the QueryClient to render under
 * @returns the wrapper component
 */
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
        lastCreatedAt: '2026-11-18T00:00:00.000Z',
        lastId: '10000000-0000-4000-8000-000000000001',
      },
    };
    const page2: KeysetList<Language> = {
      items: [languages[1] as Language],
      next: null,
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);

    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });

    render(<Probe />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.queryByText('en')).toBeTruthy();
    });
    expect(screen.getByText('ar')).toBeTruthy();
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2);
    const firstUrl = vi.mocked(apiFetch).mock.calls[0]?.[0];
    expect(firstUrl).toContain('orderBy=asc');
    expect(firstUrl).toContain('pageSize=100');
    const secondUrl = vi.mocked(apiFetch).mock.calls[1]?.[0];
    expect(secondUrl).toContain('lastId=');
  });

  it('invalidating the catalogue refetches a stale language selector', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ items: [languages[0] as Language], next: null })
      .mockResolvedValueOnce({
        items: [languages[0] as Language, languages[1] as Language],
        next: null,
      });

    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    render(<InvalidateProbe />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.queryByText('en')).toBeTruthy();
    });
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Invalidate' }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['languages'] });
    });
    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('ar')).toBeTruthy();
  });

  it('surfaces a fetch failure as an error state', async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('boom'));

    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });

    render(<Probe />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.queryByText('error')).toBeTruthy();
    });
  });

  it('stops after the hop cap when every page keeps advertising a next cursor', async () => {
    const firstRow = languages[0];
    if (!firstRow) throw new Error('language fixture is empty');
    vi.mocked(apiFetch).mockResolvedValue({
      items: [firstRow],
      next: { lastCreatedAt: '2026-11-18T00:00:00.000Z', lastId: 'loop-cursor' },
    });

    const client = new QueryClient({
      defaultOptions: { queries: { gcTime: 0, retry: false } },
    });

    render(<Probe />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(10);
    });
    expect(screen.getAllByText('en')).toHaveLength(10);
  });
});
