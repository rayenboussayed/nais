import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureApp } from './bootstrap.js';
import { setSttBodyLimit } from './configs/body-limit.js';
import { API_GLOBAL_PREFIX } from './constants/app.js';

/** Shared mock handles for the collaborators `configureApp` wires together. */
const m = vi.hoisted(() => ({
  appGet: vi.fn(),
  config: { get: vi.fn() },
  enableShutdownHooks: vi.fn(),
  getHttpAdapter: vi.fn(),
  helmet: vi.fn(),
  httpInstance: { addHook: vi.fn() },
  ioAdapter: vi.fn(),
  register: vi.fn(),
  registerHttpGuards: vi.fn(),
  setGlobalPrefix: vi.fn(),
  setupSwagger: vi.fn(),
  useWebSocketAdapter: vi.fn(),
}));

vi.mock('@fastify/helmet', () => ({ __esModule: true, default: m.helmet }));
vi.mock('@nestjs/config', () => ({ ConfigService: class {} }));
vi.mock('@nestjs/platform-socket.io', () => ({ IoAdapter: m.ioAdapter }));
vi.mock('./guards/request-guards.js', () => ({ registerHttpGuards: m.registerHttpGuards }));
vi.mock('./swagger.js', () => ({ setupSwagger: m.setupSwagger }));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('configureApp', () => {
  it('wires helmet CSP, the WS adapter, prefix, guards, Swagger and shutdown hooks', async () => {
    m.register.mockResolvedValue(undefined);
    m.getHttpAdapter.mockReturnValue({ getInstance: () => m.httpInstance });

    const app = {
      enableShutdownHooks: m.enableShutdownHooks,
      get: m.appGet.mockReturnValue(m.config),
      getHttpAdapter: m.getHttpAdapter,
      register: m.register,
      setGlobalPrefix: m.setGlobalPrefix,
      useWebSocketAdapter: m.useWebSocketAdapter,
    } as unknown as NestFastifyApplication;

    await configureApp(app);

    expect(m.register).toHaveBeenCalledWith(m.helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    });
    expect(m.ioAdapter).toHaveBeenCalledWith(app);
    const wsAdapter = m.useWebSocketAdapter.mock.calls[0]?.[0];
    expect(wsAdapter).toBeInstanceOf(m.ioAdapter);
    expect(m.setGlobalPrefix).toHaveBeenCalledWith(API_GLOBAL_PREFIX);
    expect(m.appGet).toHaveBeenCalledWith(ConfigService);
    expect(m.registerHttpGuards).toHaveBeenCalledWith(m.httpInstance, m.config);
    expect(m.httpInstance.addHook).toHaveBeenCalledWith('onRoute', setSttBodyLimit);
    expect(m.setupSwagger).toHaveBeenCalledWith(app);
    expect(m.enableShutdownHooks).toHaveBeenCalledWith(undefined, { useProcessExit: true });
  });
});
