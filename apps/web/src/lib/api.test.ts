import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, ApiError, toQueryString } from './api';

describe('toQueryString', () => {
  it('builds a query string and skips empty values', () => {
    expect(toQueryString({ q: 'hello', pageSize: 20, cursor: undefined, raw: '' })).toBe(
      '?q=hello&pageSize=20',
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
      vi.fn(async () =>
        new Response(JSON.stringify({ items: [1, 2] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const body = await apiFetch<{ items: number[] }>('/api/languages');
    expect(body.items).toEqual([1, 2]);
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('totally not json', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'content-type': 'text/plain' },
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
      vi.fn(async () =>
        new Response(JSON.stringify({ statusCode: 400, message: ['a', 'b'] }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const error = await apiFetch('/api/x', { method: 'POST', body: '{}' }).catch(
      (cause: unknown) => cause,
    );
    expect((error as ApiError).apiMessage).toBe('a; b');
  });

  it('throws ApiError with the API message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ statusCode: 409, message: 'Language with this ISO 639-1 code already exists' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const error = await apiFetch('/api/languages', { method: 'POST', body: '{}' }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).apiMessage).toBe('Language with this ISO 639-1 code already exists');
  });

  it('throws an authentication error on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    await expect(apiFetch('/api/languages')).rejects.toMatchObject({ status: 401 });
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(apiFetch('/api/languages/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
