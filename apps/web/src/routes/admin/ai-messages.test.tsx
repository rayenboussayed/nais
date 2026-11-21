// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiMessage, AiMessagePrompt, KeysetList } from '../../lib/types';

import { apiFetch } from '../../lib/api';
import { Route as adminRoute } from '../admin';
import { Route } from './ai-messages';

vi.mock('../../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

const AiMessagesAdmin = Route.options.component as () => React.ReactElement;

const longResponse = 'x'.repeat(161);

const completed: AiMessage = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  id: '10000000-0000-4000-8000-000000000001',
  model: 'bonsai-2:2b',
  provider: 'ollama',
  response: 'short answer',
  status: 'completed',
  updatedAt: '2026-11-18T00:00:00.000Z',
  usage: null,
};

const failed: AiMessage = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  id: '10000000-0000-4000-8000-000000000002',
  model: 'Xenova/distilbert',
  provider: 'transformers',
  response: longResponse,
  status: 'failed',
  updatedAt: '2026-11-18T00:00:00.000Z',
  usage: null,
};

const pending: AiMessage = {
  createdAt: '2026-11-18T00:00:00.000Z',
  deletedAt: null,
  id: '10000000-0000-4000-8000-000000000003',
  model: 'bonsai-2:2b',
  provider: 'ollama',
  response: null,
  status: 'pending',
  updatedAt: '2026-11-18T00:00:00.000Z',
  usage: null,
};

const messagePrompts: AiMessagePrompt[] = [
  {
    createdAt: '2026-11-18T00:00:00.000Z',
    id: '20000000-0000-4000-8000-000000000001',
    messageId: completed.id,
    prompt: 'system prompt',
    role: 'system',
  },
  {
    createdAt: '2026-11-18T00:00:00.000Z',
    id: '20000000-0000-4000-8000-000000000002',
    messageId: completed.id,
    prompt: 'user prompt',
    role: 'user',
  },
];

/**
 * Installs a responder for the audit list and its prompts endpoint.
 * @param rows - audit rows returned by the list endpoint
 * @param prompts - prompt rows returned by the prompts endpoint
 */
function mockApi(rows: AiMessage[], prompts: AiMessagePrompt[] = []) {
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    const path = typeof url === 'string' ? url : String(url);
    if (init?.method === 'DELETE') return undefined;
    if (path.endsWith('/prompts')) return prompts;
    if (path.startsWith('/api/ai-messages'))
      return { items: rows, next: null } as KeysetList<AiMessage>;
    throw new Error(`unexpected url ${path}`);
  });
}

/**
 * Renders the AI-messages admin under a throwaway query client.
 * @returns the render result
 */
function renderAdmin() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: 0, retry: false } },
  });
  return render(<AiMessagesAdmin />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('AiMessagesAdmin', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    mockApi([completed, failed, pending], messagePrompts);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders rows with status badges, provider, truncation and empty responses', async () => {
    renderAdmin();

    await waitFor(() => expect(screen.getByText('short answer')).toBeTruthy());
    expect(screen.getByText('completed').className).toContain('badge-ok');
    expect(screen.getByText('failed').className).toContain('badge-fail');
    expect(screen.getByText('pending').className).toContain('badge-warn');
    expect(screen.getAllByText('bonsai-2:2b')).toHaveLength(2);
    expect(screen.getAllByText('ollama')).toHaveLength(2);
    expect(screen.getByText(`${'x'.repeat(160)}…`)).toBeTruthy();
    expect(screen.queryByText(longResponse)).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows the empty state when the audit list has no rows', async () => {
    mockApi([]);
    renderAdmin();

    await waitFor(() => expect(screen.getByText('No AI messages found.')).toBeTruthy());
  });

  it('expands and collapses the prompts for a row', async () => {
    renderAdmin();
    await waitFor(() => expect(screen.getByText('short answer')).toBeTruthy());

    const promptButtons = screen.getAllByRole('button', { name: 'Prompts' });
    const first = promptButtons[0];
    if (!first) throw new Error('no Prompts button');
    fireEvent.click(first);

    await waitFor(() => expect(screen.getByText('system prompt')).toBeTruthy());
    expect(screen.getByText('user prompt')).toBeTruthy();
    expect(screen.getByText('system').className).toContain('badge');
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(screen.queryByText('system prompt')).toBeNull());
  });

  it('shows a loading state while prompts are being fetched', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      const path = typeof url === 'string' ? url : String(url);
      if (path.endsWith('/prompts')) return new Promise<never>(() => undefined);
      if (path.startsWith('/api/ai-messages'))
        return { items: [completed], next: null } as KeysetList<AiMessage>;
      throw new Error(`unexpected url ${path}`);
    });

    renderAdmin();
    await waitFor(() => expect(screen.getByText('short answer')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Prompts' }));

    await waitFor(() => expect(screen.getByText('Loading prompts…')).toBeTruthy());
  });

  it('shows No prompts when the endpoint returns an empty array', async () => {
    mockApi([completed], []);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('short answer')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Prompts' }));

    await waitFor(() => expect(screen.getByText('No prompts.')).toBeTruthy());
  });

  it('shows No prompts when the prompts request yields no data', async () => {
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      const path = typeof url === 'string' ? url : String(url);
      if (path.endsWith('/prompts')) throw new Error('unavailable');
      if (path.startsWith('/api/ai-messages'))
        return { items: [completed], next: null } as KeysetList<AiMessage>;
      throw new Error(`unexpected url ${path}`);
    });

    renderAdmin();
    await waitFor(() => expect(screen.getByText('short answer')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Prompts' }));

    await waitFor(() => expect(screen.getByText('No prompts.')).toBeTruthy());
  });

  it('does not delete when the confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('short answer')).toBeTruthy());

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const first = deleteButtons[0];
    if (!first) throw new Error('no Delete button');
    fireEvent.click(first);

    expect(confirmSpy).toHaveBeenCalledWith(
      'Soft-delete this bonsai-2:2b call from the audit log?',
    );
    expect(vi.mocked(apiFetch).mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
      false,
    );
  });

  it('soft-deletes after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAdmin();
    await waitFor(() => expect(screen.getByText('short answer')).toBeTruthy());

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const first = deleteButtons[0];
    if (!first) throw new Error('no Delete button');
    fireEvent.click(first);

    await waitFor(() =>
      expect(
        vi
          .mocked(apiFetch)
          .mock.calls.some(
            ([url, init]) => String(url).endsWith(completed.id) && init?.method === 'DELETE',
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
      if (path.endsWith('/prompts')) return messagePrompts;
      if (path.startsWith('/api/ai-messages'))
        return { items: [completed], next: null } as KeysetList<AiMessage>;
      throw new Error(`unexpected url ${path}`);
    });

    renderAdmin();
    await waitFor(() => expect(screen.getByText('short answer')).toBeTruthy());

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' });
    const first = deleteButtons[0];
    if (!first) throw new Error('no Delete button');
    fireEvent.click(first);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Could not delete the entry.'));
  });
});

describe('route metadata', () => {
  it('declares its parent route', () => {
    expect(Route.options.getParentRoute()).toBe(adminRoute);
  });
});
