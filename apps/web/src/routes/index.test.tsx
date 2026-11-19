// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language } from '@trainslator/shared';

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
        onDone: (r: { text: string; cached: boolean }) => void;
        onError: (m: string) => void;
      },
    ) => {
      const result = `translated(${targetLanguage}): ${text}`;
      callbacks.onDone({ text: result, cached: false });
      return { requestId: '123e4567-e89b-42d3-a456-426655440000' };
    },
  ),
}));

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
    name: 'French',
    nativeName: 'Français',
    iso6391: 'fr',
    dir: 'ltr',
    isSource: false,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
  },
];

const page: KeysetList<Language> = { items: languages, next: null };

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
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
    expect(screen.queryByText(/^en · /)).toBeTruthy();
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
