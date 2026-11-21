// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language, Translation } from './lib/types';

import { apiFetch } from './lib/api';
import { TranslationsAdmin } from './routes/admin/translations';

vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/api')>();
  return { ...original, apiFetch: vi.fn() };
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
];

const translationId = '10000000-0000-4000-8000-000000000010';

const translations: Translation[] = [
  {
    createdAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
    id: translationId,
    key: 'home.title',
    languageId: '10000000-0000-4000-8000-000000000001',
    namespace: 'static',
    parentId: null,
    text: 'Accueil',
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

describe('TranslationsAdmin', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      const path = typeof url === 'string' ? url : String(url);
      if (path.startsWith('/api/languages'))
        return { items: languages, next: null } as KeysetList<Language>;
      if (path.startsWith('/api/translations'))
        return { items: translations, next: null } as KeysetList<Translation>;
      throw new Error(`unexpected url in test: ${path}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders rows from the API and the empty create form is offered', async () => {
    render(<TranslationsAdmin />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.queryByText('home.title', { exact: false })).toBeTruthy();
    });
    expect(screen.getByText('Accueil')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New translation' })).toBeTruthy();
  });

  it('soft-deletes a row after confirmation and refreshes the list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      const path = typeof url === 'string' ? url : String(url);
      if (path === `/api/translations/${translationId}` && init?.method === 'DELETE') {
        return undefined;
      }
      if (path.startsWith('/api/languages'))
        return { items: languages, next: null } as KeysetList<Language>;
      if (path.startsWith('/api/translations'))
        return { items: translations, next: null } as KeysetList<Translation>;
      throw new Error(`unexpected url in test: ${path}`);
    });

    render(<TranslationsAdmin />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.queryByText('Accueil')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(
        vi
          .mocked(apiFetch)
          .mock.calls.some(
            ([url, init]) => String(url).endsWith(`/${translationId}`) && init?.method === 'DELETE',
          ),
      ).toBe(true);
    });
    confirmSpy.mockRestore();
  });
});
