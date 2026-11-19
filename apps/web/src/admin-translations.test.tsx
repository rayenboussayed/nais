// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language, Translation } from '@trainslator/shared';

import { apiFetch } from './lib/api';
import { TranslationsAdmin } from './routes/admin/translations';

vi.mock('./lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/api')>();
  return { ...original, apiFetch: vi.fn() };
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
];

const translations: Translation[] = [
  {
    id: '10000000-0000-4000-8000-000000000010',
    languageId: '10000000-0000-4000-8000-000000000001',
    namespace: 'static',
    key: 'home.title',
    text: 'Accueil',
    parentId: null,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
  },
];

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
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
    expect(screen.queryByText('Accueil')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New translation' })).toBeTruthy();
  });
});
