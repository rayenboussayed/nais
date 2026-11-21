// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language, Translation } from '../../lib/types';

import { apiFetch } from '../../lib/api';
import { Route as adminRoute } from '../admin';
import { Route, TranslationsAdmin } from './translations';

vi.mock('../../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

const language: Language = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  dir: 'ltr',
  id: '10000000-0000-4000-8000-000000000001',
  iso6391: 'fr',
  isSource: false,
  name: 'French',
  nativeName: 'Français',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

const translation: Translation = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  id: '30000000-0000-4000-8000-000000000001',
  key: 'home.title',
  languageId: language.id,
  namespace: 'static',
  parentId: null,
  text: 'Accueil',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

/**
 * Installs responders for the language catalogue and the translation list.
 * @param rows - translation rows returned by the list endpoint
 */
function mockApi(rows: Translation[]) {
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    const path = typeof url === 'string' ? url : String(url);
    if (init?.method === 'DELETE') return undefined;
    if (path.startsWith('/api/languages'))
      return { items: [language], next: null } as KeysetList<Language>;
    if (path.startsWith('/api/translations'))
      return { items: rows, next: null } as KeysetList<Translation>;
    throw new Error(`unexpected url ${path}`);
  });
}

/**
 * Renders the translations admin under a throwaway query client.
 * @returns the render result
 */
function renderAdmin() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return render(<TranslationsAdmin />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('TranslationsAdmin', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    mockApi([translation]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the list and offers the language catalogue as a filter', async () => {
    renderAdmin();

    await waitFor(() => expect(screen.getByText('Accueil')).toBeTruthy());
    expect(screen.getByRole('option', { name: 'fr — Français' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New translation' })).toBeTruthy();
  });

  it('refetches with the selected language and namespace filters', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Accueil')).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Filter by language'), {
      target: { value: language.id },
    });
    await waitFor(() =>
      expect(
        vi
          .mocked(apiFetch)
          .mock.calls.some(([url]) => String(url).includes(`languageId=${language.id}`)),
      ).toBe(true),
    );

    fireEvent.change(screen.getByLabelText('Filter by namespace'), {
      target: { value: 'dynamic' },
    });
    await waitFor(() =>
      expect(
        vi.mocked(apiFetch).mock.calls.some(([url]) => String(url).includes('namespace=dynamic')),
      ).toBe(true),
    );
  });

  it('opens the create and edit modals', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Accueil')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'New translation' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Text')).toHaveProperty('value', '');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Text')).toHaveProperty('value', 'Accueil');
  });

  it('does not delete when the confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Accueil')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmSpy).toHaveBeenCalledWith('Soft-delete "Accueil…"?');
    expect(vi.mocked(apiFetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
      false,
    );
  });

  it('soft-deletes after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('Accueil')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(
        vi
          .mocked(apiFetch)
          .mock.calls.some(
            ([url, init]) =>
              String(url).endsWith(`/${translation.id}`) && init?.method === 'DELETE',
          ),
      ).toBe(true),
    );
  });

  it('alerts when a soft-delete fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      const path = typeof url === 'string' ? url : String(url);
      if (init?.method === 'DELETE') throw new Error('nope');
      if (path.startsWith('/api/languages'))
        return { items: [language], next: null } as KeysetList<Language>;
      if (path.startsWith('/api/translations'))
        return { items: [translation], next: null } as KeysetList<Translation>;
      throw new Error(`unexpected url ${path}`);
    });

    renderAdmin();
    await waitFor(() => expect(screen.getByText('Accueil')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not delete the translation.'));
  });
});

describe('route metadata', () => {
  it('declares its parent route', () => {
    expect(Route.options.getParentRoute()).toBe(adminRoute);
  });
});
