import { describe, expect, it, vi } from 'vitest';

import type { Server, Socket } from 'socket.io';

import { TranslateGateway } from './translate.gateway';

function makeGateway() {
  // Only the connect limiter is under test; the services are never reached
  // because unauthenticated handshakes fail first.
  const translations = { findByLanguageAndKey: vi.fn() };
  const languages = { findByIso: vi.fn() };
  const pgBoss = { scheduleJob: vi.fn() };
  const config = { get: () => undefined };
  const gateway = new TranslateGateway(
    translations as never,
    languages as never,
    pgBoss as never,
    config as never,
  );
  return gateway;
}

function fakeServer() {
  let middleware: ((socket: Socket, next: (error?: Error) => void) => void) | undefined;
  const server = {
    use: (fn: typeof middleware) => {
      middleware = fn;
    },
  } as unknown as Server;
  return { server, getMiddleware: () => middleware };
}

const fakeSocket = () =>
  ({
    handshake: { headers: {}, address: '203.0.113.9' },
    data: {},
  }) as unknown as Socket;

describe('TranslateGateway handshake backstop', () => {
  it('routes an unexpected middleware failure to unauthorized instead of hanging', async () => {
    const gateway = makeGateway();
    const { server, getMiddleware } = fakeServer();
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
    const { server, getMiddleware } = fakeServer();
    gateway.afterInit(server);

    const middleware = getMiddleware();
    if (!middleware) throw new Error('middleware not registered');

    const socketFor = (address?: string) =>
      ({
        handshake: address === undefined ? { headers: {} } : { headers: {}, address },
        data: {},
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
    const { server, getMiddleware } = fakeServer();
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
