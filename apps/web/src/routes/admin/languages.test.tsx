// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language } from '../../lib/types';

import { ApiError, apiFetch } from '../../lib/api';
import { createLanguageSchema, updateLanguageBodySchema } from '../../lib/forms';
import { Route as adminRoute } from '../admin';
import { Route } from './languages';

vi.mock('../../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

const LanguagesAdmin = Route.options.component as () => React.ReactElement;

const english: Language = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  dir: 'ltr',
  id: '10000000-0000-4000-8000-000000000001',
  iso6391: 'en',
  isSource: true,
  name: 'English',
  nativeName: 'English',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

const arabic: Language = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  dir: 'rtl',
  id: '10000000-0000-4000-8000-000000000002',
  iso6391: 'ar',
  isSource: false,
  name: 'Arabic',
  nativeName: 'العربية',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

/**
 * Returns the first request of a given HTTP method made through apiFetch.
 * @param method - HTTP method to match
 * @returns the matching mock call, if any
 */
function callFor(method: string) {
  return vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method === method);
}

/** Fills the language form with a valid draft. */
function fillForm() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'German' } });
  fireEvent.change(screen.getByLabelText('Native name'), { target: { value: 'Deutsch' } });
  fireEvent.change(screen.getByLabelText('ISO 639-1'), { target: { value: 'DE' } });
  fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'rtl' } });
  fireEvent.click(screen.getByLabelText(/Source language/));
}

/**
 * Installs a list responder returning the supplied language page.
 * @param rows - language rows returned by the list endpoint
 */
function mockLanguages(rows: Language[]) {
  vi.mocked(apiFetch).mockImplementation(async (url) => {
    const path = typeof url === 'string' ? url : String(url);
    if (path.startsWith('/api/languages'))
      return { items: rows, next: null } as KeysetList<Language>;
    throw new Error(`unexpected url ${path}`);
  });
}

/** Opens the create dialog and waits for it to appear. */
async function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: 'New language' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
}

/**
 * Renders the languages admin under a throwaway query client.
 * @returns the render result
 */
function renderAdmin() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return render(<LanguagesAdmin />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('LanguagesAdmin', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    mockLanguages([english, arabic]);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders populated rows with source badges, script direction and timestamps', async () => {
    renderAdmin();

    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    expect(screen.getByText('العربية')).toBeTruthy();
    expect(screen.getByText('source')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('ltr')).toBeTruthy();
    expect(screen.getByText('rtl')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New language' })).toBeTruthy();
  });

  it('shows the empty state when the list has no rows', async () => {
    mockLanguages([]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('No languages found.')).toBeTruthy());
  });

  it('lowercases the ISO code as the user types', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    await openCreate();

    fireEvent.change(screen.getByLabelText('ISO 639-1'), { target: { value: 'FR' } });
    expect(screen.getByLabelText('ISO 639-1')).toHaveProperty('value', 'fr');
  });

  it('shows a validation error for an invalid create and then posts a valid draft', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    await openCreate();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    fillForm();
    expect(screen.getByLabelText('ISO 639-1')).toHaveProperty('value', 'de');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = callFor('POST');
    if (!post) throw new Error('create POST was not sent');
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      dir: 'rtl',
      iso6391: 'de',
      isSource: true,
      name: 'German',
      nativeName: 'Deutsch',
    });
  });

  it('falls back to Invalid input when a create validation error carries no issues', async () => {
    vi.spyOn(createLanguageSchema, 'safeParse').mockReturnValue({
      error: { issues: [] },
      success: false,
    } as never);

    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    await openCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid input'));
  });

  it('rejects an edit that changes no field', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));

    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    const firstEdit = editButtons[0];
    if (!firstEdit) throw new Error('no Edit button');
    fireEvent.click(firstEdit);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Provide at least one field'),
    );
  });

  it('patches only the changed fields when editing', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));

    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    const firstEdit = editButtons[0];
    if (!firstEdit) throw new Error('no Edit button');
    fireEvent.click(firstEdit);

    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patch = callFor('PATCH');
    if (!patch) throw new Error('edit PATCH was not sent');
    expect(String(patch[0])).toContain(`/${english.id}`);
    expect(JSON.parse(String(patch[1]?.body))).toEqual({
      dir: 'rtl',
      iso6391: 'de',
      isSource: false,
      name: 'German',
      nativeName: 'Deutsch',
    });
  });

  it('falls back to Invalid input when an edit validation error carries no issues', async () => {
    vi.spyOn(updateLanguageBodySchema, 'safeParse').mockReturnValue({
      error: { issues: [] },
      success: false,
    } as never);

    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    const firstEdit = editButtons[0];
    if (!firstEdit) throw new Error('no Edit button');
    fireEvent.click(firstEdit);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid input'));
  });

  it('shows the API message from an ApiError and its plain message when absent', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      const path = typeof url === 'string' ? url : String(url);
      if (init?.method === 'POST') throw new ApiError(409, 'Conflict', 'ISO already exists');
      if (path.startsWith('/api/languages'))
        return { items: [english], next: null } as KeysetList<Language>;
      throw new Error(`unexpected url ${path}`);
    });

    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    await openCreate();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('ISO already exists'),
    );

    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      const path = typeof url === 'string' ? url : String(url);
      if (init?.method === 'POST') throw new ApiError(500, 'Server exploded');
      if (path.startsWith('/api/languages'))
        return { items: [english], next: null } as KeysetList<Language>;
      throw new Error(`unexpected url ${path}`);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Server exploded'));
  });

  it('shows the generic failure message for a non-ApiError', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      const path = typeof url === 'string' ? url : String(url);
      if (init?.method === 'POST') throw new Error('boom');
      if (path.startsWith('/api/languages'))
        return { items: [english], next: null } as KeysetList<Language>;
      throw new Error(`unexpected url ${path}`);
    });

    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    await openCreate();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Something went wrong. Please try again.',
      ),
    );
  });

  it('ignores a second submit while the first one is still busy', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      const path = typeof url === 'string' ? url : String(url);
      if (init?.method === 'POST') return new Promise<never>(() => undefined);
      if (path.startsWith('/api/languages'))
        return { items: [english], next: null } as KeysetList<Language>;
      throw new Error(`unexpected url ${path}`);
    });

    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    await openCreate();
    fillForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const form = screen.getByRole('dialog').querySelector('form');
    if (!form) throw new Error('no form');
    fireEvent.submit(form);

    expect(callFor('POST')).toBeDefined();
    expect(
      vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('closes the dialog on Cancel', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    await openCreate();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not delete when the confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const firstDelete = deleteButtons[0];
    if (!firstDelete) throw new Error('no Delete button');
    fireEvent.click(firstDelete);

    expect(confirmSpy).toHaveBeenCalledWith('Soft-delete English (en)?');
    expect(callFor('DELETE')).toBeUndefined();
  });

  it('soft-deletes after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const firstDelete = deleteButtons[0];
    if (!firstDelete) throw new Error('no Delete button');
    fireEvent.click(firstDelete);

    await waitFor(() => expect(callFor('DELETE')).toBeDefined());
  });

  it('alerts when a soft-delete fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      const path = typeof url === 'string' ? url : String(url);
      if (init?.method === 'DELETE') throw new Error('nope');
      if (path.startsWith('/api/languages'))
        return { items: [english], next: null } as KeysetList<Language>;
      throw new Error(`unexpected url ${path}`);
    });

    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const firstDelete = deleteButtons[0];
    if (!firstDelete) throw new Error('no Delete button');
    fireEvent.click(firstDelete);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not delete the language.'));
  });

  it('invalidates the list and then the language catalogue after a successful save', async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));
    await openCreate();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const listKey = JSON.stringify(['admin', 'languages']);
    const catalogueKey = JSON.stringify(['languages']);
    const invalidatedKeys = () =>
      invalidateSpy.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
    await waitFor(() => {
      expect(invalidatedKeys()).toContain(listKey);
      expect(invalidatedKeys()).toContain(catalogueKey);
    });
    expect(invalidatedKeys().indexOf(catalogueKey)).toBeGreaterThan(
      invalidatedKeys().indexOf(listKey),
    );
  });

  it('titles the edit modal with the edited row native name', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0));

    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    const arabicEdit = editButtons[1];
    if (!arabicEdit) throw new Error('no Edit button');
    fireEvent.click(arabicEdit);

    expect(screen.getByText('Edit العربية')).toBeTruthy();
  });
});

describe('route metadata', () => {
  it('declares its parent route', () => {
    expect(Route.options.getParentRoute()).toBe(adminRoute);
  });
});
