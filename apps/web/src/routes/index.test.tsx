import type { KeysetList, Language } from '@trainslator/shared';

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '../lib/api';
import { translateText } from '../lib/translate-socket';
import { Playground } from './index';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

vi.mock('../lib/translate-socket', () => ({
  translateText: vi.fn(
    (
      text: string,
      targetLanguage: string,
      callbacks: {
        onDone: (r: { cached: boolean; text: string }) => void;
        onError: (m: string) => void;
      },
    ) => {
      const result = `translated(${targetLanguage}): ${text}`;
      callbacks.onDone({ cached: false, text: result });
      return { requestId: '123e4567-e89b-42d3-a456-426655440000' };
    },
  ),
}));

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
    vi.mocked(translateText).mockClear();
    vi.mocked(apiFetch).mockResolvedValue(page);
  });

  afterEach(() => {
    cleanup();
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
});
