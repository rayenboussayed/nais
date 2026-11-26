// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language } from '../lib/types';

import { apiFetch } from '../lib/api';
import { translateText } from '../lib/translate-socket';
import { Route as rootRoute } from './__root';
import { Playground, Route } from './index';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

vi.mock('../lib/translate-socket', () => ({ translateText: vi.fn() }));

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
    dir: 'ltr',
    id: '10000000-0000-4000-8000-000000000002',
    iso6391: 'fr',
    isSource: false,
    name: 'French',
    nativeName: 'Français',
    updatedAt: '2026-11-18T00:00:00.000Z',
  },
];

const page: KeysetList<Language> = { items: languages, next: null };

/** Callbacks accepted by the translate request. */
interface PendingCallbacks {
  onDone: (result: { cached: boolean; text: string }) => void;
  onError: (message: string) => void;
}

/**
 * Captures the callbacks of the next translate request without settling it.
 * @returns a getter for the captured callbacks
 */
function deferTranslation() {
  const holder: { current?: PendingCallbacks } = {};
  vi.mocked(translateText).mockImplementationOnce((_text, _targetLanguage, callbacks) => {
    holder.current = callbacks;
    return { requestId: '123e4567-e89b-42d3-a456-426655440000' };
  });
  return () => {
    const callbacks = holder.current;
    if (!callbacks) throw new Error('translation was not started');
    return callbacks;
  };
}

/**
 * Replaces the clipboard with a spy so copy behaviour is observable.
 * @returns the writeText spy
 */
function stubClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  return writeText;
}

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

describe('Playground', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(translateText).mockReset();
    vi.mocked(apiFetch).mockResolvedValue(page);
    vi.mocked(translateText).mockImplementation((text, targetLanguage, callbacks) => {
      callbacks.onDone({ cached: false, text: `translated(${targetLanguage}): ${text}` });
      return { requestId: '123e4567-e89b-42d3-a456-426655440000' };
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not translate an empty source', async () => {
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    expect(translateText).not.toHaveBeenCalled();
  });

  it('lists the languages and translates the entered text on submit', async () => {
    render(<Playground />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'hello world' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    await waitFor(() => {
      expect(screen.queryByText('translated(en): hello world')).toBeTruthy();
    });
    expect(translateText).toHaveBeenCalledWith(
      'hello world',
      'en',
      expect.objectContaining({ onDone: expect.any(Function), onError: expect.any(Function) }),
    );

    // History records the run
    expect(screen.getByText(/^en · /)).toBeTruthy();
  });

  it('does not call the model when the textarea is empty', async () => {
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(translateText).not.toHaveBeenCalled();
  });

  it('shows the running state until the translation settles', async () => {
    const callbacks = deferTranslation();
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    expect(translateText).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Translating…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('status').textContent).toBe('Translating…');
    expect(screen.queryByText('The translation will appear here.')).toBeNull();

    await act(async () => {
      callbacks().onDone({ cached: false, text: 'salut' });
    });
    expect(screen.getByRole('button', { name: 'Translate' })).toBeTruthy();
    expect(screen.getByText('salut')).toBeTruthy();
  });

  it('surfaces a translation error and returns to the idle state', async () => {
    const callbacks = deferTranslation();
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    await act(async () => {
      callbacks().onError('The translation failed. Please try again.');
    });

    expect(screen.getByRole('alert').textContent).toBe('The translation failed. Please try again.');
    expect(screen.getByRole('button', { name: 'Translate' })).toBeTruthy();
    expect(screen.getByText('The translation will appear here.')).toBeTruthy();
  });

  it('marks cache hits in the result and in session history', async () => {
    vi.mocked(translateText).mockImplementationOnce((text, targetLanguage, callbacks) => {
      callbacks.onDone({ cached: true, text: `cached(${targetLanguage}): ${text}` });
      return { requestId: '123e4567-e89b-42d3-a456-426655440000' };
    });
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'bonjour' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    await waitFor(() => {
      expect(screen.getByText('cached')).toBeTruthy();
    });
    expect(screen.getByText(/^en · cached · /)).toBeTruthy();
  });

  it('copies the translation to the clipboard', async () => {
    const writeText = stubClipboard();
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('translated(en): hello');
    });
  });

  it('does not copy an empty translation', async () => {
    const writeText = stubClipboard();
    vi.mocked(translateText).mockImplementationOnce((_text, _targetLanguage, callbacks) => {
      callbacks.onDone({ cached: false, text: '' });
      return { requestId: '123e4567-e89b-42d3-a456-426655440000' };
    });
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('clears history and restores a past run when its entry is clicked', async () => {
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'first' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(screen.getByText(/^en · /)).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'second' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^en · / })).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^en · / })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^en · / })).toBeTruthy());
    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'changed' },
    });
    fireEvent.change(screen.getByLabelText('Translate into'), { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: /^en · / }));

    expect(screen.getByRole('textbox', { name: 'Source text' })).toHaveProperty('value', 'second');
    expect(screen.getByLabelText('Translate into')).toHaveProperty('value', 'en');
    expect(screen.getByText('translated(en): second')).toBeTruthy();
  });

  it('truncates long history entries in the list', async () => {
    const long = 'x'.repeat(90);
    render(<Playground />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: long },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^en · / })).toBeTruthy());

    const entry = screen.getByRole('button', { name: /^en · / });
    expect(entry.textContent).toContain(`${'x'.repeat(80)}…`);
    expect(entry.textContent).not.toContain('x'.repeat(81));
  });
});

describe('route metadata', () => {
  it('declares its parent route', () => {
    expect(Route.options.getParentRoute()).toBe(rootRoute);
  });
});
