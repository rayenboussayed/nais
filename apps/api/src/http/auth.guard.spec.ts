import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { describe, expect, it } from 'vitest';

import type { Env } from '../config/env.js';

import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from '../../test/auth.js';
import { SESSION_COOKIE_NAME, signSession } from '../auth/session.js';
import { HttpAuthGuard } from './auth.guard.js';

/**
 * Stubs ConfigService with the keys the unit under test reads.
 * @param overrides - env keys to override in the stubbed parsed config
 * @returns the ConfigService double
 */
function configStub(overrides: Partial<Record<keyof Env, string | undefined>> = {}) {
  const base: Record<string, string | undefined> = {
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x',
    NODE_ENV: 'development',
    OLLAMA_BASE_URL: 'http://127.0.0.1:1',
    PORT: '3000',
    ...TEST_BASIC_AUTH_ENV,
    ...overrides,
  };
  return {
    // eslint-disable-next-line security/detect-object-injection -- test stub: config keys are compile-time constants of the stub
    get: (key: string) => base[key],
  } as unknown as ConfigService<Env, true>;
}

/**
 * Builds an ExecutionContext for the http path.
 * @param headers - the request headers
 * @param url - the request path
 * @returns the context double
 */
function httpContext(
  headers: Record<string, string | string[] | undefined>,
  url = '/api/languages',
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ headers, url }) }),
  } as unknown as ExecutionContext;
}

/**
 * Builds an ExecutionContext for a websocket context.
 * @returns the context double
 */
function wsContext(): ExecutionContext {
  return { getType: () => 'ws' } as unknown as ExecutionContext;
}

describe('HttpAuthGuard', () => {
  it('passes /api/health and /api/auth/login without credentials', async () => {
    const guard = new HttpAuthGuard(configStub());
    await expect(guard.canActivate(httpContext({}, '/api/health'))).resolves.toBe(true);
    await expect(guard.canActivate(httpContext({}, '/api/health/'))).resolves.toBe(true);
    await expect(guard.canActivate(httpContext({}, '/api/auth/login'))).resolves.toBe(true);
    await expect(guard.canActivate(httpContext({}, '/api/health?probe=1'))).resolves.toBe(true);
  });

  it('rejects unauthenticated requests to protected routes', async () => {
    const guard = new HttpAuthGuard(configStub());
    await expect(guard.canActivate(httpContext({}))).rejects.toThrow('Unauthorized');
  });

  it('accepts a valid basic auth header', async () => {
    const guard = new HttpAuthGuard(configStub());
    await expect(guard.canActivate(httpContext(basicAuthHeaders()))).resolves.toBe(true);
  });

  it('accepts a valid session cookie', async () => {
    const config = configStub();
    const cookie = `${SESSION_COOKIE_NAME}=${signSession('admin', 'a'.repeat(64)).value}`;
    const guard = new HttpAuthGuard(config);
    await expect(guard.canActivate(httpContext({ cookie }))).resolves.toBe(true);
  });

  it('http basic wins over cookie; an invalid basic header rejects even with a good cookie', async () => {
    const cookie = `${SESSION_COOKIE_NAME}=${signSession('admin', 'a'.repeat(64)).value}`;
    const guard = new HttpAuthGuard(configStub());

    await expect(
      guard.canActivate(
        httpContext({
          ...basicAuthHeaders(),
          cookie: `${SESSION_COOKIE_NAME}=forged.signature`,
        }),
      ),
    ).resolves.toBe(true);

    await expect(
      guard.canActivate(httpContext({ authorization: 'Basic unparseable', cookie })),
    ).rejects.toThrow('Unauthorized');
  });

  it('returns false for a context without getType (hostile host)', async () => {
    const guard = new HttpAuthGuard(configStub());
    const hostile = {} as unknown as ExecutionContext;
    await expect(guard.canActivate(hostile)).rejects.toThrow();
  });

  it('passes websocket contexts through without credentials', async () => {
    const guard = new HttpAuthGuard(configStub());
    await expect(guard.canActivate(wsContext())).resolves.toBe(true);
  });
});
