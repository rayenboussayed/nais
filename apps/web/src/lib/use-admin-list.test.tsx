// @vitest-environment jsdom
import type { KeysetList } from '@trainslator/shared';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from './api';
import { useAdminList } from './use-admin-list';

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return { ...original, apiFetch: vi.fn() };
});

/** Minimal row shape used by the probe. */
interface Row {
  id: string;
  label: string;
}

const first: Row = { id: 'row-1', label: 'first' };
const second: Row = { id: 'row-2', label: 'second' };

/**
 * Builds one list envelope for the probe.
 * @param items - rows on this page
 * @param next - cursor for the following page, or null on the last one
 * @returns a keyset list envelope
 */
function page(items: Row[], next: KeysetList<Row>['next'] = null): KeysetList<Row> {
  return { items, next };
}

/**
 * Probe that exposes every piece of shared list state as text and controls.
 * @returns the probe element
 */
function Probe() {
  const [deleteStatus, setDeleteStatus] = useState('');
  const list = useAdminList<Row>({
    endpoint: '/api/languages',
    pageSize: 2,
    resource: 'languages',
  });

  /**
   * Runs the shared delete action and records its outcome.
   */
  async function remove() {
    try {
      await list.deleteRow('row-1');
      setDeleteStatus('deleted');
    } catch {
      setDeleteStatus('failed');
    }
  }

  return (
    <div>
      <span data-testid="status">{statusText(list.isFetching, list.isError)}</span>
      <span data-testid="rows">{list.rows.map((row) => row.label).join(',')}</span>
      <span data-testid="delete">{deleteStatus}</span>
      <input
        aria-label="Search"
        onChange={(event) => list.setSearch(event.target.value)}
        value={list.search}
      />
      <button disabled={!list.canBack} onClick={list.back} type="button">
        Newer
      </button>
      <button disabled={!list.hasNext} onClick={list.nextPage} type="button">
        Older
      </button>
      <button onClick={() => void remove()} type="button">
        Delete
      </button>
      <button onClick={list.resetPage} type="button">
        Reset
      </button>
    </div>
  );
}

/**
 * Maps query state to the status text shown by the probe.
 * @param isFetching - whether the list query is fetching
 * @param isError - whether the list query failed
 * @returns the status label
 */
function statusText(isFetching: boolean, isError: boolean): string {
  if (isFetching) return 'loading';
  if (isError) return 'error';
  return 'ready';
}

/**
 * Test wrapper with a throwaway QueryClient and no retries.
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

describe('useAdminList', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading while the first page is in flight, then renders rows', async () => {
    let resolvePage: ((value: KeysetList<Row>) => void) | undefined;
    vi.mocked(apiFetch).mockImplementation(
      () =>
        new Promise<KeysetList<Row>>((resolve) => {
          resolvePage = resolve;
        }),
    );

    render(<Probe />, { wrapper: wrapper() });
    expect(screen.getByTestId('status').textContent).toBe('loading');

    await act(async () => {
      resolvePage?.(page([first]));
    });

    await waitFor(() => {
      expect(screen.getByTestId('rows').textContent).toBe('first');
    });
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(String(vi.mocked(apiFetch).mock.calls[0]?.[0])).toContain('pageSize=2');
  });

  it('renders an empty page with no error flag', async () => {
    vi.mocked(apiFetch).mockResolvedValue(page([]));

    render(<Probe />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });
    expect(screen.getByTestId('rows').textContent).toBe('');
  });

  it('exposes the query failure without rows', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'));

    render(<Probe />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('error');
    });
    expect(screen.getByTestId('rows').textContent).toBe('');
  });

  it('walks forward and back through keyset cursors', async () => {
    const cursor = { lastCreatedAt: '2026-11-18T00:00:01.000Z', lastId: 'row-1' };
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      if (String(url).includes('lastId=')) return page([second]);
      return page([first], cursor);
    });

    render(<Probe />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('rows').textContent).toBe('first');
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Newer' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => {
      expect(screen.getByTestId('rows').textContent).toBe('second');
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Newer' }).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
    await waitFor(() => {
      expect(screen.getByTestId('rows').textContent).toBe('first');
    });
    expect(String(vi.mocked(apiFetch).mock.calls[0]?.[0])).not.toContain('lastId=');
  });

  it('filters by search term and drops the cursor on a new search', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      page([first], { lastCreatedAt: '2026-11-18T00:00:01.000Z', lastId: 'row-1' }),
    );

    render(<Probe />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Older' }));
    await waitFor(() => {
      expect(
        vi.mocked(apiFetch).mock.calls.some(([url]) => String(url).includes('lastId=row-1')),
      ).toBe(true);
    });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'hello world' } });
    await waitFor(() => {
      const url = String(vi.mocked(apiFetch).mock.calls.at(-1)?.[0]);
      expect(url).toContain('q=hello+world');
      expect(url).not.toContain('lastId=');
    });
  });

  it('deletes a row then refreshes the list query', async () => {
    vi.mocked(apiFetch).mockResolvedValue(page([first]));

    render(<Probe />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('rows').textContent).toBe('first');
    });
    vi.mocked(apiFetch).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByTestId('delete').textContent).toBe('deleted');
    });
    const calls = vi.mocked(apiFetch).mock.calls;
    expect(
      calls.some(([url, init]) => url === '/api/languages/row-1' && init?.method === 'DELETE'),
    ).toBe(true);
    expect(calls.some(([url]) => String(url).startsWith('/api/languages?'))).toBe(true);
  });

  it('surfaces a failed delete to the caller', async () => {
    vi.mocked(apiFetch).mockResolvedValue(page([first]));

    render(<Probe />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.getByTestId('rows').textContent).toBe('first');
    });
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error('nope'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByTestId('delete').textContent).toBe('failed');
    });
  });
});
