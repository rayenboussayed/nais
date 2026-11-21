// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Language, Translation } from '../../lib/types';

import { ApiError, apiFetch } from '../../lib/api';
import { createTranslationSchema, updateTranslationBodySchema } from '../../lib/forms';
import { type TranslationEditing, TranslationsForm } from './translations-form';

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

const otherLanguage: Language = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  dir: 'ltr',
  id: '10000000-0000-4000-8000-000000000002',
  iso6391: 'en',
  isSource: true,
  name: 'English',
  nativeName: 'English',
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
 * Returns the first request of a given HTTP method made through apiFetch.
 * @param method - HTTP method to match
 * @returns the matching mock call, if any
 */
function callFor(method: string) {
  return vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method === method);
}

/**
 * Default no-op callbacks plus a blank create form.
 * @param rows - languages available to the form
 * @returns the create-mode props
 */
function createProps(rows: Language[] = [language, otherLanguage]) {
  return {
    editing: { mode: 'create' } as NonNullable<TranslationEditing>,
    languages: rows,
    onClose: vi.fn(),
    onSaved: vi.fn(async () => undefined),
  };
}

/**
 * Default no-op callbacks plus a translation row in edit mode.
 * @returns the edit-mode props
 */
function editProps() {
  return {
    editing: { mode: 'edit', row: translation } as NonNullable<TranslationEditing>,
    languages: [language, otherLanguage],
    onClose: vi.fn(),
    onSaved: vi.fn(async () => undefined),
  };
}

/**
 * Renders the translation form with a throwable query client in context.
 * @param props - props passed to the form
 * @returns the render result
 */
function renderForm(props: ReturnType<typeof createProps>) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return render(<TranslationsForm {...props} />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('TranslationsForm', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('creates a dynamic translation, seeding the first language and closing on success', async () => {
    const props = createProps();
    renderForm(props);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('Language')).toHaveProperty('value', language.id);
    expect(screen.queryByLabelText('Key')).toBeNull();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(props.onSaved).toHaveBeenCalled();
    const post = callFor('POST');
    if (!post) throw new Error('create POST was not sent');
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      languageId: language.id,
      namespace: 'dynamic',
      text: 'Hello world',
    });
  });

  it('reveals the Key field in static mode and posts it', async () => {
    const props = createProps();
    renderForm(props);

    fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'static' } });
    expect(screen.getByLabelText('Key')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: otherLanguage.id } });
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'home.title' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    const post = callFor('POST');
    if (!post) throw new Error('create POST was not sent');
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      key: 'home.title',
      languageId: otherLanguage.id,
      namespace: 'static',
      text: 'Hello world',
    });
  });

  it('reports a validation error for an empty static key', async () => {
    const props = createProps();
    renderForm(props);

    fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'static' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('falls back to Invalid input when a create validation error carries no issues', async () => {
    vi.spyOn(createTranslationSchema, 'safeParse').mockReturnValue({
      error: { issues: [] },
      success: false,
    } as never);

    renderForm(createProps());
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid input'));
  });

  it('fails validation when no language is available to preselect', async () => {
    renderForm(createProps([]));
    expect(screen.getByLabelText('Language')).toHaveProperty('value', '');
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('seeds the edit form from the row and rejects an unchanged edit', async () => {
    const props = editProps();
    renderForm(props);

    expect(screen.getByLabelText('Language')).toHaveProperty('value', translation.languageId);
    expect(screen.getByLabelText('Namespace')).toHaveProperty('value', 'static');
    expect(screen.getByLabelText('Key')).toHaveProperty('value', translation.key);
    expect(screen.getByLabelText('Text')).toHaveProperty('value', translation.text);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Provide at least one field'),
    );
  });

  it('patches all changed fields of an edited translation', async () => {
    const props = editProps();
    renderForm(props);

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'home.subtitle' } });
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: otherLanguage.id } });
    fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'dynamic' } });
    expect(screen.queryByLabelText('Key')).toBeNull();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Bonjour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    const patch = callFor('PATCH');
    if (!patch) throw new Error('edit PATCH was not sent');
    expect(String(patch[0])).toContain(`/${translation.id}`);
    expect(JSON.parse(String(patch[1]?.body))).toEqual({
      key: 'home.subtitle',
      languageId: otherLanguage.id,
      namespace: 'dynamic',
      text: 'Bonjour',
    });
  });

  it('falls back to Invalid input when an edit validation error carries no issues', async () => {
    vi.spyOn(updateTranslationBodySchema, 'safeParse').mockReturnValue({
      error: { issues: [] },
      success: false,
    } as never);

    const props = editProps();
    renderForm(props);
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Bonjour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid input'));
  });

  it('shows the ApiError apiMessage and falls back to its plain message', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      if (init?.method === 'POST') throw new ApiError(400, 'Bad request', 'Key already exists');
      throw new Error(`unexpected url ${String(url)}`);
    });

    renderForm(createProps());
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Key already exists'),
    );

    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      if (init?.method === 'POST') throw new ApiError(500, 'Server exploded');
      throw new Error(`unexpected url ${String(url)}`);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Server exploded'));
  });

  it('shows the generic failure message for a non-ApiError', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      if (init?.method === 'POST') throw new Error('boom');
      throw new Error(`unexpected url ${String(url)}`);
    });

    renderForm(createProps());
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Something went wrong. Please try again.',
      ),
    );
  });

  it('ignores a second save while the first is still busy', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url, init) => {
      if (init?.method === 'POST') return new Promise<never>(() => undefined);
      throw new Error(`unexpected url ${String(url)}`);
    });

    renderForm(createProps());
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const form = screen.getByRole('dialog').querySelector('form');
    if (!form) throw new Error('no form');
    fireEvent.submit(form);

    expect(
      vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });

  it('closes without saving on Cancel', async () => {
    const props = createProps();
    renderForm(props);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSaved).not.toHaveBeenCalled();
  });
});
