import type { ConfigService } from '@nestjs/config';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { describe, expect, it } from 'vitest';

import type { Env } from '../environment.js';

import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from '../../test/auth.js';
import { registerHttpGuards } from './request-guards.js';

const LOCAL_ORIGIN = 'http://127.0.0.1:3000';

/**
 * Reply stub: accumulates code/headers/body like FastifyReply, synchronously.
 * @returns the stubbed reply and its captured state
 */
function makeReply() {
  const state = { body: undefined as unknown, headers: {} as Record<string, string>, status: 200 };
  const chain = {
    code(code: number) {
      state.status = code;
      return chain;
    },
    header(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
      return chain;
    },
    send: async (body: unknown) => {
      state.body = body;
      return state;
    },
  };
  return { reply: chain as unknown as FastifyReply, state };
}

/**
 * Builds a FastifyRequest double.
 * @param method - the request method
 * @param url - the request url
 * @param headers - the request headers
 * @returns the request double
 */
function requestFor(
  method: string,
  url: string,
  headers: Record<string, string | string[] | undefined>,
): FastifyRequest {
  return { headers, method, url } as unknown as FastifyRequest;
}

/**
 * Captures the two hooks registered by registerHttpGuards: [origin, docs-auth].
 * @param corsOrigins - the CORS_ORIGINS value to stub, when set
 * @returns the captured hooks and reply/state helpers
 */
function setup(corsOrigins?: string) {
  const config = {
    // eslint-disable-next-line security/detect-object-injection -- test stub: key is the CORS_ORIGINS env name or a compile-time constant
    get: (key: string) => (key === 'CORS_ORIGINS' ? corsOrigins : TEST_BASIC_AUTH_ENV[key]),
  } as unknown as ConfigService<Env, true>;

  const hooks: Array<(request: FastifyRequest, reply: FastifyReply) => Promise<void>> = [];
  const fastify = {
    addHook: (
      _name: string,
      fn: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
    ) => {
      hooks.push(fn);
    },
  } as unknown as FastifyInstance;

  registerHttpGuards(fastify, config);

  return {
    docsHook: hooks[1] as (r: FastifyRequest, reply: FastifyReply) => Promise<void>,
    originHook: hooks[0] as (r: FastifyRequest, reply: FastifyReply) => Promise<void>,
  };
}

describe('registerHttpGuards origin backstop', () => {
  it('lets a mutation through when no Origin header is present (curl)', async () => {
    const { originHook } = setup();
    const { reply, state } = makeReply();
    await originHook(requestFor('POST', '/api/translate', { host: '127.0.0.1:3000' }), reply);
    expect(state.body).toBeUndefined();
  });

  it('rejects a mutation with a foreign Origin', async () => {
    const { originHook } = setup();
    const { reply, state } = makeReply();
    await originHook(
      requestFor('POST', '/api/translate', {
        host: '127.0.0.1:3000',
        origin: 'https://evil.example.com',
      }),
      reply,
    );
    expect(state.status).toBe(403);
    expect(state.body).toMatchObject({ message: 'Forbidden origin', statusCode: 403 });
  });

  it('accepts a same-origin mutation (host equal)', async () => {
    const { originHook } = setup();
    const { reply, state } = makeReply();
    await originHook(
      requestFor('POST', '/api/translate', { host: '127.0.0.1:3000', origin: LOCAL_ORIGIN }),
      reply,
    );
    expect(state.body).toBeUndefined();
  });

  it('passes non-mutating methods regardless of Origin', async () => {
    const { originHook } = setup();
    const { reply, state } = makeReply();
    await originHook(
      requestFor('GET', '/api/translate', {
        host: '127.0.0.1:3000',
        origin: 'https://evil.example.com',
      }),
      reply,
    );
    expect(state.body).toBeUndefined();
  });

  it('rejects a foreign Origin that arrives as an array', async () => {
    const { originHook } = setup();
    const { reply, state } = makeReply();
    await originHook(
      requestFor('POST', '/api/translate', {
        host: '127.0.0.1:3000',
        origin: ['https://evil.example.com'],
      }),
      reply,
    );
    expect(state.status).toBe(403);
  });

  it('accepts the first array entry when it matches', async () => {
    const { originHook } = setup();
    const { reply, state } = makeReply();
    await originHook(
      requestFor('POST', '/api/translate', {
        host: '127.0.0.1:3000',
        origin: [LOCAL_ORIGIN, 'https://evil.example.com'],
      }),
      reply,
    );
    expect(state.body).toBeUndefined();
  });

  it('honors the CORS_ORIGINS allowlist for non-same-origin mutation', async () => {
    const { originHook } = setup('https://admin.example.com');
    const { reply, state } = makeReply();
    await originHook(
      requestFor('POST', '/api/translate', {
        host: '127.0.0.1:3000',
        origin: 'https://admin.example.com',
      }),
      reply,
    );
    expect(state.body).toBeUndefined();
  });
});

describe('registerHttpGuards swagger backstop', () => {
  it('rejects unauthenticated /api/docs requests with 401 and a realm header', async () => {
    const { docsHook } = setup();
    const { reply, state } = makeReply();
    await docsHook(requestFor('GET', '/api/docs', { host: '127.0.0.1:3000' }), reply);
    expect(state.status).toBe(401);
    expect(state.headers['www-authenticate']).toContain('Basic realm="trainslator"');
    expect(state.body).toMatchObject({ message: 'Unauthorized', statusCode: 401 });
  });

  it('rejects unauthenticated /api/docs-json requests with 401', async () => {
    const { docsHook } = setup();
    const { reply, state } = makeReply();
    await docsHook(requestFor('GET', '/api/docs-json', {}), reply);
    expect(state.status).toBe(401);
  });

  it('passes /api/docs through with valid credentials', async () => {
    const { docsHook } = setup();
    const { reply, state } = makeReply();
    await docsHook(requestFor('GET', '/api/docs', basicAuthHeaders()), reply);
    expect(state.body).toBeUndefined();
  });

  it('ignores non-docs paths', async () => {
    const { docsHook } = setup();
    const { reply, state } = makeReply();
    await docsHook(requestFor('GET', '/api/languages', {}), reply);
    expect(state.body).toBeUndefined();
  });
});
