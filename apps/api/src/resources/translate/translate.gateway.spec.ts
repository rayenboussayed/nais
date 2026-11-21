import type { Server, Socket } from 'socket.io';

import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WsTranslateAck } from '../../schemas/translations.js';

import { TranslateGateway } from './translate.gateway.js';

/**
 * Fake socket.io server capturing the handshake middleware.
 * @returns the server double and its middleware getter
 */
function fakeServer() {
  let middleware: ((socket: Socket, next: (error?: Error) => void) => void) | undefined;
  const server = {
    use: (fn: typeof middleware) => {
      middleware = fn;
    },
  } as unknown as Server;
  return { getMiddleware: () => middleware, server };
}

/**
 * Builds the gateway with unimplemented services; only the handshake limiter is under test.
 * @returns the gateway under test
 */
function makeGateway() {
  // Only the connect limiter is under test; the services are never reached
  // because unauthenticated handshakes fail first.
  const translations = { findByLanguageAndKey: vi.fn() };
  const languages = { findByIso: vi.fn() };
  const pgBoss = { scheduleJob: vi.fn() };
  const config = { get: () => undefined };
  const ai = { listTasks: vi.fn(), modelFor: vi.fn(), peekCache: vi.fn(), run: vi.fn() };
  const gateway = new TranslateGateway(
    translations as never,
    languages as never,
    pgBoss as never,
    config as never,
    ai as never,
  );
  return gateway;
}

const fakeSocket = () =>
  ({
    data: {},
    handshake: { address: '203.0.113.9', headers: {} },
  }) as unknown as Socket;

describe('TranslateGateway handshake backstop', () => {
  it('routes an unexpected middleware failure to unauthorized instead of hanging', async () => {
    const gateway = makeGateway();
    const { getMiddleware, server } = fakeServer();
    gateway.afterInit(server);

    const middleware = getMiddleware();
    if (!middleware) throw new Error('middleware not registered');

    const socket = {
      get handshake() {
        throw new Error('corrupt handshake');
      },
    } as unknown as Socket;

    const result = await new Promise<Error | undefined>((resolve) => {
      middleware(socket, (error?: Error) => resolve(error));
    });
    expect(result?.message).toBe('unauthorized');
  });

  it('gives each client IP its own handshake budget', async () => {
    const gateway = makeGateway();
    const { getMiddleware, server } = fakeServer();
    gateway.afterInit(server);

    const middleware = getMiddleware();
    if (!middleware) throw new Error('middleware not registered');

    const socketFor = (address?: string) =>
      ({
        data: {},
        handshake: address === undefined ? { headers: {} } : { address, headers: {} },
      }) as unknown as Socket;

    const run = (socket: Socket) =>
      new Promise<Error | undefined>((resolve) => middleware(socket, (error) => resolve(error)));

    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    for (let i = 0; i < 60; i += 1) {
      middleware(socketFor('198.51.100.1'), () => {});
      await flush();
    }

    // IP A is exhausted; a different IP still gets its own (unauthorized) verdict, not a limit verdict.
    const forB = await run(socketFor('203.0.113.77'));
    expect(forB?.message).toBe('unauthorized');

    // The budget fell back to per-IP keys, so address-less clients share the star bucket.
    for (let i = 0; i < 60; i += 1) {
      middleware(socketFor(), () => {});
      await flush();
    }
    const addressless = await run(socketFor());
    expect(addressless?.message).toBe('too many connections');
  });

  it('rejects handshakes past the global connect limit', async () => {
    const gateway = makeGateway();
    const { getMiddleware, server } = fakeServer();
    gateway.afterInit(server);

    const middleware = getMiddleware();
    if (!middleware) throw new Error('middleware not registered');

    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    for (let i = 0; i < 60; i += 1) {
      const next = vi.fn();
      middleware(fakeSocket(), next);
      await flush();
    }

    const next = vi.fn();
    middleware(fakeSocket(), next);
    await flush();

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(next.mock.calls[0]?.[0]?.message).toBe('too many connections');
  });
});

describe('import-time gateway options', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('omits the cors block when CORS_ORIGINS is unset (preserved default)', async () => {
    vi.resetModules();
    vi.stubEnv('CORS_ORIGINS', '');
    const mod = await import('./translate.gateway.js');
    expect('cors' in mod.gatewayOptions).toBe(false);
    expect(mod.gatewayOptions.path).toBe('/socket.io');
    expect(mod.gatewayOptions.maxHttpBufferSize).toBe(65_536);
  });

  it('builds the exact-match allowlist from CORS_ORIGINS at import time', async () => {
    vi.resetModules();
    vi.stubEnv('CORS_ORIGINS', 'https://admin.example.com, https://ops.example.com');
    const mod = await import('./translate.gateway.js');
    expect(mod.gatewayOptions.cors).toEqual({
      credentials: true,
      origin: ['https://admin.example.com', 'https://ops.example.com'],
    });
  });
});

/**
 * Builds the gateway with stubbed dependencies for translate-handler unit tests.
 * @param overrides - per-test dependency behaviour
 * @param overrides.cached - the catalogue row the cache peek should see
 * @param overrides.cached.text - the catalogue text a cache hit returns
 * @param overrides.language - the language the fixture resolves, or null to model a missing one
 * @returns the gateway and its dependency stubs
 */
function makeHandlerGateway(
  overrides: {
    cached?: { text: string };
    language?: null | { id: string };
  } = {},
) {
  const translations = {
    findByLanguageAndKey: vi.fn(async () => overrides.cached ?? null),
  };
  const languages = {
    findByIso: vi.fn(async () =>
      overrides.language === undefined
        ? { id: 'lang-1', iso6391: 'fr', name: 'French' }
        : overrides.language,
    ),
  };
  const pgBoss = { scheduleJob: vi.fn(async () => undefined) };
  const config = { get: () => undefined };
  const ai = { peekCache: vi.fn(async () => null) };
  const gateway = new TranslateGateway(
    translations as never,
    languages as never,
    pgBoss as never,
    config as never,
    ai as never,
  );
  return { gateway, languages, pgBoss, translations };
}

const handlerSocket = {
  data: { username: 'admin' },
  handshake: { address: '203.0.113.9', headers: {} },
  id: 'socket-1',
} as unknown as Socket;

describe('TranslateGateway translate handler ack contract', () => {
  const requestId = '123e4567-e89b-42d3-a456-426655440000';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Collects every ack call for assertions.
   * @returns the collector and the collected ack calls
   */
  function ackCollector() {
    const calls: WsTranslateAck[] = [];
    const ack = (response: WsTranslateAck) => {
      calls.push(response);
    };
    return { ack, calls };
  }

  it('rejects a garbage payload with 400 and a null requestId', async () => {
    const { gateway } = makeHandlerGateway();
    const { ack, calls } = ackCollector();
    await gateway.translate(null, handlerSocket, ack);
    expect(calls).toEqual([{ data: null, requestId: null, statusCode: 400 }]);
  });

  it('returns a null requestId for a malformed payload without one', async () => {
    const { gateway } = makeHandlerGateway();
    const { ack, calls } = ackCollector();
    await gateway.translate({ targetLanguage: 'fr', text: 'hello' }, handlerSocket, ack);
    expect(calls).toEqual([{ data: null, requestId: null, statusCode: 400 }]);
  });

  it('extracts a valid requestId from an otherwise malformed payload for 400', async () => {
    const { gateway } = makeHandlerGateway();
    const { ack, calls } = ackCollector();
    await gateway.translate({ requestId, targetLanguage: 42, text: 'hello' }, handlerSocket, ack);
    expect(calls).toEqual([{ data: null, requestId, statusCode: 400 }]);
  });

  it('answers 429 with retryAfterMs once the identity budget is exhausted', async () => {
    const { gateway } = makeHandlerGateway();
    const message = { requestId, targetLanguage: 'fr', text: 'hello' };
    for (let i = 0; i < 10; i += 1) {
      await gateway.translate(message, handlerSocket, () => {});
    }
    const { ack, calls } = ackCollector();
    await gateway.translate(message, handlerSocket, ack);
    expect(calls).toEqual([{ data: null, requestId, retryAfterMs: 60_000, statusCode: 429 }]);
  });

  it('answers 404 for a missing language', async () => {
    const { gateway } = makeHandlerGateway({ language: null });
    const { ack, calls } = ackCollector();
    await gateway.translate({ requestId, targetLanguage: 'zz', text: 'hello' }, handlerSocket, ack);
    expect(calls).toEqual([{ data: null, requestId, statusCode: 404 }]);
  });

  it('answers 200 with the cached text inline', async () => {
    const { gateway } = makeHandlerGateway({ cached: { text: 'bonjour' } });
    const { ack, calls } = ackCollector();
    await gateway.translate({ requestId, targetLanguage: 'fr', text: 'hello' }, handlerSocket, ack);
    expect(calls).toEqual([{ data: 'bonjour', requestId, statusCode: 200 }]);
  });

  it('answers 202 and enqueues with retryLimit 0 on a cache miss', async () => {
    const { gateway, pgBoss } = makeHandlerGateway();
    const { ack, calls } = ackCollector();
    await gateway.translate({ requestId, targetLanguage: 'fr', text: 'hello' }, handlerSocket, ack);
    expect(pgBoss.scheduleJob).toHaveBeenCalledWith(
      'ai-task',
      expect.objectContaining({ requestId, task: 'translate' }),
      { retryLimit: 0 },
    );
    expect(calls).toEqual([{ data: null, requestId, statusCode: 202 }]);
  });

  it('answers 500 and logs only the error name with the translate message', async () => {
    const { gateway, languages } = makeHandlerGateway();
    languages.findByIso.mockRejectedValueOnce(new Error('db on fire'));
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { ack, calls } = ackCollector();
    await gateway.translate({ requestId, targetLanguage: 'fr', text: 'hello' }, handlerSocket, ack);
    expect(calls).toEqual([{ data: null, requestId, statusCode: 500 }]);
    expect(log).toHaveBeenCalledWith('translate handler failed: Error');
  });
});

describe('TranslateGateway.emitTo', () => {
  it('emits an outbound event to exactly one socket room', () => {
    const { gateway } = makeHandlerGateway();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    // The server is injected by @WebSocketServer at boot; assign the double directly.
    (gateway as unknown as { server: { to: typeof to } }).server = { to };

    const payload = {
      cached: true,
      requestId: '123e4567-e89b-42d3-a456-426655440000',
      text: 'bonjour',
    };
    gateway.emitTo('socket-1', 'translation', payload);

    expect(to).toHaveBeenCalledWith('socket-1');
    expect(emit).toHaveBeenCalledWith('translation', payload);
  });
});
