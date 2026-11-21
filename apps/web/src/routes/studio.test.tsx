// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiTaskDescriptor, KeysetList, Language } from '../lib/types';

import { ApiError, apiFetch } from '../lib/api';
import { Route as rootRoute } from './__root';
import { Route, Studio } from './studio';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return { ...original, apiFetch: vi.fn() };
});

const languages: Language[] = [
  {
    createdAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
    dir: 'ltr',
    id: '10000000-0000-4000-8000-000000000001',
    iso6391: 'fr',
    isSource: false,
    name: 'French',
    nativeName: 'Français',
    updatedAt: '2026-11-18T00:00:00.000Z',
  },
];

const tasks: AiTaskDescriptor[] = [
  {
    description: 'Translate into a language',
    label: 'Translate',
    model: 'bonsai-2:2b',
    provider: 'ollama',
    task: 'translate',
  },
  {
    description: 'Binary sentiment',
    label: 'Sentiment',
    model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    provider: 'transformers',
    task: 'sentiment',
  },
  {
    description: 'Extractive QA',
    label: 'Question answering',
    model: 'Xenova/distilbert-base-uncased-distilled-squad',
    provider: 'transformers',
    task: 'question-answering',
  },
  {
    description: 'Classify into arbitrary labels',
    label: 'Zero-shot classification',
    model: 'Xenova/nli-deberta-v3-xsmall',
    provider: 'transformers',
    task: 'zero-shot-classification',
  },
];

/**
 * Creates a promise that a test can settle explicitly.
 * @returns the promise and its resolver
 */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/**
 * Mocks one apiFetch responder implementation.
 * @param responder - computes the canned response per call
 * @param taskList - the task registry returned by the tasks endpoint
 */
function mockFetchOnce(
  responder: (url: string, body: unknown) => unknown,
  taskList: AiTaskDescriptor[] = tasks,
) {
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    const path = typeof url === 'string' ? url : String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === '/api/ai/tasks') return { items: taskList } as never;
    if (path.startsWith('/api/languages'))
      return { items: languages, next: null } as KeysetList<Language> as never;
    return responder(path, body) as never;
  });
}

/**
 * Counts the POST requests issued through apiFetch.
 * @returns the POST calls with their parsed bodies
 */
function postCalls() {
  return vi
    .mocked(apiFetch)
    .mock.calls.filter(([, init]) => init?.method === 'POST')
    .map(([url, init]) => ({ body: JSON.parse(String(init?.body)), url: String(url) }));
}

/**
 * Renders Studio and waits until its task registry has loaded.
 */
async function renderStudio() {
  render(<Studio />, { wrapper: wrapper() });
  await waitFor(() => {
    expect(screen.queryByRole('option', { name: 'Sentiment' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Français/ })).toBeTruthy();
  });
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

describe('Studio', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists the tasks from the service and submits a sentiment call', async () => {
    mockFetchOnce((url, body) => {
      if (url === '/api/ai/sentiment') return { cached: false, label: 'POSITIVE', score: 0.9 };
      throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
    });

    await renderStudio();

    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'sentiment' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'I love this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(screen.queryByText(/"POSITIVE"/)).toBeTruthy();
    });
    expect(screen.getByText(/"cached": false/)).toBeTruthy();
  });

  it('shows the cached badge on a cache-hit answer', async () => {
    mockFetchOnce((url) => {
      if (url === '/api/ai/sentiment') return { cached: true, label: 'POSITIVE', score: 0.9 };
      throw new Error(`unexpected ${url}`);
    });

    await renderStudio();

    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'sentiment' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'cached me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(screen.queryByText('cached', { selector: '.badge' })).toBeTruthy();
    });
  });

  it('requires both context and question for question answering and posts them', async () => {
    mockFetchOnce((url, body) => {
      if (url === '/api/ai/question-answering') return { answer: 'Jim Henson', cached: false };
      throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
    });

    await renderStudio();
    fireEvent.change(screen.getByLabelText('Task'), {
      target: { value: 'question-answering' },
    });

    expect(screen.getByLabelText('Question')).toBeTruthy();
    expect(screen.getByLabelText('Context')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run' })).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Context'), {
      target: { value: 'Jim Henson created the Muppets.' },
    });
    expect(screen.getByRole('button', { name: 'Run' })).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'Who was Jim Henson?' },
    });
    expect(screen.getByRole('button', { name: 'Run' })).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText(/"Jim Henson"/)).toBeTruthy());
    expect(postCalls()).toEqual([
      {
        body: {
          context: 'Jim Henson created the Muppets.',
          question: 'Who was Jim Henson?',
        },
        url: '/api/ai/question-answering',
      },
    ]);
  });

  it('validates and trims candidate labels for zero-shot classification', async () => {
    mockFetchOnce((url, body) => {
      if (url === '/api/ai/zero-shot-classification') return { cached: false, labels: ['urgent'] };
      throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
    });

    await renderStudio();
    fireEvent.change(screen.getByLabelText('Task'), {
      target: { value: 'zero-shot-classification' },
    });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Ship it' } });

    const labels = screen.getByLabelText('Candidate labels (comma separated)');
    fireEvent.change(labels, { target: { value: ' only one ' } });
    expect(screen.getByRole('button', { name: 'Run' })).toHaveProperty('disabled', true);

    fireEvent.change(labels, { target: { value: ' urgent , , not urgent ' } });
    expect(screen.getByRole('button', { name: 'Run' })).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText(/"urgent"/)).toBeTruthy());
    expect(postCalls()).toEqual([
      {
        body: { candidateLabels: ['urgent', 'not urgent'], text: 'Ship it' },
        url: '/api/ai/zero-shot-classification',
      },
    ]);
  });

  it('posts the selected target language for translation', async () => {
    mockFetchOnce((url, body) => {
      if (url === '/api/ai/translate') return { cached: false, text: 'Bonjour' };
      throw new Error(`unexpected ${url} ${JSON.stringify(body)}`);
    });

    await renderStudio();
    fireEvent.change(screen.getByLabelText('Into'), { target: { value: 'fr' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByText(/"Bonjour"/)).toBeTruthy());
    expect(postCalls()).toEqual([
      { body: { targetLanguage: 'fr', text: 'Hello' }, url: '/api/ai/translate' },
    ]);
  });

  it('shows a model badge and copies the JSON when the result has no cache flag', async () => {
    const writeText = stubClipboard();
    mockFetchOnce((url) => {
      if (url === '/api/ai/translate') return { text: 'Bonjour' };
      throw new Error(`unexpected ${url}`);
    });

    await renderStudio();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy JSON' })).toBeTruthy());
    expect(screen.getByText('model', { selector: '.badge' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy JSON' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(JSON.stringify({ text: 'Bonjour' }, null, 2));
    });
  });

  it('shows the API message from an error response', async () => {
    mockFetchOnce(() => {
      throw new ApiError(429, 'Too Many Requests', 'Rate limit reached. Retry in 5s.');
    });

    await renderStudio();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Rate limit reached. Retry in 5s.');
    });
  });

  it('falls back to the ApiError message when no API message is present', async () => {
    mockFetchOnce(() => {
      throw new ApiError(500, 'The translation failed. Please try again.');
    });

    await renderStudio();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'The translation failed. Please try again.',
      );
    });
  });

  it('shows the generic message for a non-API failure', async () => {
    mockFetchOnce(() => {
      throw new Error('network down');
    });

    await renderStudio();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Please try again.');
    });
  });

  it('ignores programmatic submits while invalid or already running', async () => {
    const pending = deferred<Record<string, unknown>>();
    mockFetchOnce(() => pending.promise);

    await renderStudio();
    const form = screen.getByRole('button', { name: 'Run' }).closest('form');
    if (!form) throw new Error('studio form was not rendered');

    fireEvent.submit(form);
    expect(postCalls()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(postCalls()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Running…' })).toHaveProperty('disabled', true);

    fireEvent.submit(form);
    expect(postCalls()).toHaveLength(1);

    await act(async () => {
      pending.settle({ cached: false, text: 'Bonjour' });
    });
    await waitFor(() => expect(screen.getByText(/"Bonjour"/)).toBeTruthy());
  });

  it('resets the result when the selected task changes', async () => {
    mockFetchOnce((url) => {
      if (url === '/api/ai/translate') return { cached: false, text: 'Bonjour' };
      throw new Error(`unexpected ${url}`);
    });

    await renderStudio();
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Result' })).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'sentiment' } });
    expect(screen.queryByRole('region', { name: 'Result' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy();
  });

  it('switches to the first available task when the current one is not offered', async () => {
    const registry: AiTaskDescriptor[] = [
      {
        description: 'Binary sentiment',
        label: 'Sentiment',
        model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
        provider: 'transformers',
        task: 'sentiment',
      },
    ];
    mockFetchOnce(() => {
      throw new Error('no AI call expected');
    }, registry);

    await renderStudio();
    expect(screen.getByLabelText('Task')).toHaveProperty('value', 'sentiment');
    expect(screen.queryByRole('option', { name: 'Translate' })).toBeNull();
  });
});

describe('route metadata', () => {
  it('declares its parent route', () => {
    expect(Route.options.getParentRoute()).toBe(rootRoute);
  });
});
