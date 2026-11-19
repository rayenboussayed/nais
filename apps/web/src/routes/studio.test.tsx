// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiTaskDescriptor, KeysetList, Language } from '@trainslator/shared';

import { apiFetch } from '../lib/api';
import { Studio } from './studio';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

const languages: Language[] = [
  {
    id: '10000000-0000-4000-8000-000000000001',
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

const tasks: AiTaskDescriptor[] = [
  {
    task: 'translate',
    provider: 'ollama',
    model: 'bonsai-2:2b',
    label: 'Translate',
    description: 'Translate into a language',
  },
  {
    task: 'sentiment',
    provider: 'transformers',
    model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    label: 'Sentiment',
    description: 'Binary sentiment',
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

function mockFetchOnce(responder: (url: string, body: unknown) => unknown) {
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    const path = typeof url === 'string' ? url : String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === '/api/ai/tasks') return { items: tasks } as never;
    if (path === '/api/languages') return { items: languages, next: null } as KeysetList<Language> as never;
    return responder(path, body) as never;
  });
}

describe('Studio', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('lists the tasks from the service and submits a sentiment call', async () => {
    mockFetchOnce((url, body) => {
      if (url === '/api/ai/sentiment') return { label: 'POSITIVE', score: 0.9, cached: false };
      throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
    });

    render(<Studio />, { wrapper: wrapper() });

    // wait for the task list to load
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Sentiment' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'sentiment' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'I love this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(screen.queryByText(/"POSITIVE"/)).toBeTruthy();
    });
    expect(screen.queryByText(/"cached": false/)).toBeTruthy();
  });

  it('shows the cached badge on a cache-hit answer', async () => {
    mockFetchOnce((url) => {
      if (url === '/api/ai/sentiment') return { label: 'POSITIVE', score: 0.9, cached: true };
      throw new Error(`unexpected ${url}`);
    });

    render(<Studio />, { wrapper: wrapper() });

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Sentiment' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'sentiment' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'cached me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(screen.queryByText('cached', { selector: '.badge' })).toBeTruthy();
    });
  });
});
