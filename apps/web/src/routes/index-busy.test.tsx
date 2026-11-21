// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KeysetList, Language } from '../lib/types';

import { apiFetch } from '../lib/api';
import { translateText } from '../lib/translate-socket';
import { Playground } from './index';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

vi.mock('../lib/translate-socket', () => ({ translateText: vi.fn() }));

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

/**
 * Invokes a React handler directly so a disabled button still exercises the guard in the handler.
 * @param element - element holding the React props
 */
function invokeOnClick(element: HTMLElement): void {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'));
  if (!key) throw new Error('React props not found on element');
  const props: unknown = Reflect.get(element, key);
  if (!props || typeof props !== 'object' || !('onClick' in props)) {
    throw new Error('onClick prop not found on element');
  }
  const onClick: unknown = Reflect.get(props, 'onClick');
  if (typeof onClick !== 'function') throw new Error('onClick is not callable');
  act(() => {
    onClick();
  });
}

/**
 * Renders children under a throwaway query client.
 * @param props - component props holding the children
 * @param props.children - the subtree rendered under the provider
 * @returns the provider element
 */
function wrapper(props: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>;
}

describe('Playground concurrent submit guard', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    vi.mocked(translateText).mockReset();
    vi.mocked(apiFetch).mockResolvedValue({
      items: [language],
      next: null,
    } as KeysetList<Language>);
    vi.mocked(translateText).mockReturnValue({
      requestId: '123e4567-e89b-42d3-a456-426655440000',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('ignores a second submit while the first translation is running', async () => {
    render(<Playground />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByText('Français (fr)')).toBeTruthy();
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Source text' }), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }));

    expect(translateText).toHaveBeenCalledTimes(1);

    // React suppresses clicks on disabled buttons, so invoke the handler
    // through the element props to exercise the guard in run() itself.
    invokeOnClick(screen.getByRole('button', { name: 'Translating…' }));

    expect(translateText).toHaveBeenCalledTimes(1);
  });
});
