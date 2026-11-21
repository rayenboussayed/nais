import { afterEach, describe, expect, it, vi } from 'vitest';

import type { operations } from '../../../../generated/api';

import { ApiError, apiFetch, toQueryString } from './api';

describe('toQueryString', () => {
  it('builds a query string and skips empty values', () => {
    expect(toQueryString({ cursor: undefined, pageSize: 20, q: 'hello', raw: '' })).toBe(
      '?pageSize=20&q=hello',
    );
  });

  it('returns an empty string when nothing is set', () => {
    expect(toQueryString({ a: undefined, b: '' })).toBe('');
  });

  it('encodes special characters', () => {
    expect(toQueryString({ q: 'a b&c' })).toBe('?q=a+b%26c');
  });
});

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a JSON response on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [1, 2] }), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    const body = await apiFetch<{ items: number[] }>('/api/languages');
    expect(body.items).toEqual([1, 2]);
  });

  it('falls back to the status text when the error body is a JSON scalar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('42', {
            headers: { 'content-type': 'application/json' },
            status: 503,
            statusText: 'Service Unavailable',
          }),
      ),
    );
    const error = await apiFetch('/api/health').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('Service Unavailable');
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('totally not json', {
            headers: { 'content-type': 'text/plain' },
            status: 503,
            statusText: 'Service Unavailable',
          }),
      ),
    );
    const error = await apiFetch('/api/health').catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).message).toBe('Service Unavailable');
  });

  it('falls back when the error body is a JSON array message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: ['a', 'b'], statusCode: 400 }), {
            headers: { 'content-type': 'application/json' },
            status: 400,
          }),
      ),
    );
    const error = await apiFetch('/api/x', { body: '{}', method: 'POST' }).catch(
      (cause: unknown) => cause,
    );
    expect((error as ApiError).apiMessage).toBe('a; b');
  });

  it('throws ApiError with the API message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message: 'Language with this ISO 639-1 code already exists',
              statusCode: 409,
            }),
            {
              headers: { 'content-type': 'application/json' },
              status: 409,
            },
          ),
      ),
    );
    const error = await apiFetch('/api/languages', { body: '{}', method: 'POST' }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).apiMessage).toBe('Language with this ISO 639-1 code already exists');
  });

  it('extracts the message from a full shared error envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Conflict',
              message: 'Language with this ISO 639-1 code already exists',
              statusCode: 409,
            }),
            { headers: { 'content-type': 'application/json' }, status: 409 },
          ),
      ),
    );
    const error = await apiFetch('/api/languages', { body: '{}', method: 'POST' }).catch(
      (cause: unknown) => cause,
    );
    expect((error as ApiError).apiMessage).toBe('Language with this ISO 639-1 code already exists');
    expect((error as ApiError).message).toBe('Language with this ISO 639-1 code already exists');
  });

  it('surfaces a legacy message-only body when shared validation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'legacy shape' }), {
            headers: { 'content-type': 'application/json' },
            status: 400,
            statusText: 'Bad Request',
          }),
      ),
    );
    const error = await apiFetch('/api/x', { body: '{}', method: 'POST' }).catch(
      (cause: unknown) => cause,
    );
    expect((error as ApiError).apiMessage).toBe('legacy shape');
    expect((error as ApiError).message).toBe('legacy shape');
    expect((error as ApiError).status).toBe(400);
  });

  it('joins a legacy array-only message body with semicolons', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: ['legacy a', 'legacy b'] }), {
            headers: { 'content-type': 'application/json' },
            status: 400,
          }),
      ),
    );
    const error = await apiFetch('/api/x', { body: '{}', method: 'POST' }).catch(
      (cause: unknown) => cause,
    );
    expect((error as ApiError).apiMessage).toBe('legacy a; legacy b');
  });

  it('falls back to the status text when the body lacks message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ statusCode: 400 }), {
            headers: { 'content-type': 'application/json' },
            status: 400,
            statusText: 'Bad Request',
          }),
      ),
    );
    const error = await apiFetch('/api/x', { body: '{}', method: 'POST' }).catch(
      (cause: unknown) => cause,
    );
    expect((error as ApiError).message).toBe('Bad Request');
  });

  it('throws an authentication error on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await expect(apiFetch('/api/languages')).rejects.toMatchObject({ status: 401 });
  });

  it('ignores a 401 response body and keeps the synthetic authentication error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Unauthorized', statusCode: 401 }), {
            headers: { 'content-type': 'application/json' },
            status: 401,
          }),
      ),
    );
    const error = await apiFetch('/api/languages').catch((cause: unknown) => cause);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('Authentication required');
    expect((error as ApiError).apiMessage).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(apiFetch('/api/languages/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

/** Compile-time proof that the committed generated HTTP types drive the client. */
type LanguagesList =
  operations['LanguagesController_findAll']['responses'][200]['content']['application/json'];

describe('typed apiFetch client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns data shaped by the generated response type', async () => {
    const expected: LanguagesList = { items: [], next: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(expected), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    const body = await apiFetch<LanguagesList>('/api/languages');
    expect(body).toEqual(expected);
  });

  it('passes an encoded query string through the typed client unchanged', async () => {
    let seenUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        seenUrl = request.url;
        return new Response(JSON.stringify({ items: [], next: null }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }),
    );
    await apiFetch<LanguagesList>('/api/languages?q=a+b%26c');
    expect(seenUrl).toContain('q=a+b%26c');
  });

  it('routes GET /api/ai-messages through the typed client', async () => {
    const expected = { items: [{ id: 1, role: 'user' }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(expected), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    await expect(apiFetch('/api/ai-messages')).resolves.toEqual(expected);
  });

  it('routes GET /api/translations through the typed client', async () => {
    const expected = { items: [], next: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(expected), {
            headers: { 'content-type': 'application/json' },
            status: 200,
          }),
      ),
    );
    await expect(apiFetch('/api/translations')).resolves.toEqual(expected);
  });

  it('returns undefined for a 204 from a typed GET path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(apiFetch('/api/ai/tasks')).resolves.toBeUndefined();
  });

  it('forwards headers and an abort signal through the typed client', async () => {
    let seen: Request | undefined;
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        seen = request;
        return new Response(JSON.stringify({ items: [], next: null }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }),
    );

    await apiFetch<LanguagesList>('/api/languages', {
      headers: { 'x-trace-id': 'trace-1' },
      signal: controller.signal,
    });

    expect(seen?.headers.get('x-trace-id')).toBe('trace-1');
    controller.abort();
    expect(seen?.signal.aborted).toBe(true);
  });

  it('uses the plain fetch fallback for a GET to an untyped path', async () => {
    let seenUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        seenUrl = input instanceof Request ? input.url : String(input);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }),
    );

    await expect(apiFetch<{ ok: boolean }>('/api/x?q=1')).resolves.toEqual({ ok: true });
    expect(seenUrl).toContain('/api/x?q=1');
  });

  it('ignores a legacy message array with a non-string part', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: ['ok', 42] }), {
            headers: { 'content-type': 'application/json' },
            status: 400,
            statusText: 'Bad Request',
          }),
      ),
    );

    const error = await captureError(apiFetch('/api/x', { method: 'POST' }));
    expect(error?.message).toBe('Bad Request');
    expect(error?.apiMessage).toBeUndefined();
  });

  it('falls back to the status text when a fallback error body is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('not json', {
            headers: { 'content-type': 'text/plain' },
            status: 503,
            statusText: 'Service Unavailable',
          }),
      ),
    );

    const error = await captureError(apiFetch('/api/x', { method: 'POST' }));
    expect(error?.message).toBe('Service Unavailable');
    expect(error?.apiMessage).toBeUndefined();
  });
});

/**
 * Captures an {@link ApiError} rejection without an unsafe cast.
 * @param promise - the request promise whose rejection is inspected
 * @returns the ApiError when it rejected with one, otherwise null
 */
function captureError(promise: Promise<unknown>): Promise<ApiError | null> {
  return promise.then(
    () => null,
    (cause: unknown) => (cause instanceof ApiError ? cause : null),
  );
}

describe('response mapping parity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps the same full error envelope identically on typed and fallback paths', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Bad Request',
              message: ['first problem', 'second problem'],
              statusCode: 400,
            }),
            {
              headers: { 'content-type': 'application/json' },
              status: 400,
              statusText: 'Bad Request',
            },
          ),
      ),
    );

    const typed = await captureError(apiFetch('/api/languages'));
    const fallback = await captureError(apiFetch('/api/x', { body: '{}', method: 'POST' }));

    expect(typed).toBeInstanceOf(ApiError);
    expect(fallback).toBeInstanceOf(ApiError);
    expect(typed?.status).toBe(fallback?.status);
    expect(typed?.message).toBe(fallback?.message);
    expect(typed?.apiMessage).toBe(fallback?.apiMessage);
    expect(typed?.status).toBe(400);
    expect(typed?.message).toBe('first problem; second problem');
    expect(typed?.apiMessage).toBe('first problem; second problem');
  });

  it('maps the same legacy message-only body identically on both paths', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'legacy shape' }), {
            headers: { 'content-type': 'application/json' },
            status: 400,
            statusText: 'Bad Request',
          }),
      ),
    );

    const typed = await captureError(apiFetch('/api/health'));
    const fallback = await captureError(apiFetch('/api/x', { body: '{}', method: 'POST' }));

    expect(typed).toBeInstanceOf(ApiError);
    expect(fallback).toBeInstanceOf(ApiError);
    expect(typed?.message).toBe(fallback?.message);
    expect(typed?.apiMessage).toBe(fallback?.apiMessage);
    expect(typed?.apiMessage).toBe('legacy shape');
  });

  it('maps the same non-JSON error body to the status text on both paths', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('not json', {
            headers: { 'content-type': 'text/plain' },
            status: 503,
            statusText: 'Service Unavailable',
          }),
      ),
    );

    const typed = await captureError(apiFetch('/api/health'));
    const fallback = await captureError(apiFetch('/api/x', { body: '{}', method: 'POST' }));

    expect(typed).toBeInstanceOf(ApiError);
    expect(fallback).toBeInstanceOf(ApiError);
    expect(typed?.status).toBe(fallback?.status);
    expect(typed?.message).toBe(fallback?.message);
    expect(typed?.message).toBe('Service Unavailable');
  });

  it('keeps a cursor containing a UTC offset intact through the typed client', async () => {
    let seenUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        seenUrl = request.url;
        return new Response(JSON.stringify({ items: [], next: null }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        });
      }),
    );

    const query = toQueryString({ cursor: '2026-11-21T10:00:00+00:00' });
    await apiFetch<LanguagesList>(`/api/languages${query}`);
    expect(seenUrl).toContain('cursor=2026-11-21T10%3A00%3A00%2B00%3A00');
  });
});
