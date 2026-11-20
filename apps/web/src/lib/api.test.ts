import { afterEach, describe, expect, it, vi } from 'vitest';

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
