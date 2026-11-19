import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { Env } from '../config/env.js';
import { SESSION_COOKIE_NAME, signSession } from '../auth/session.js';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from '../../test/auth.js';

import { HttpAuthGuard } from './auth.guard.js';

function configStub(overrides: Partial<Record<keyof Env, string | undefined>> = {}) {
  const base: Record<string, string | undefined> = {
    NODE_ENV: 'development',
    PORT: '3000',
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x',
    OLLAMA_BASE_URL: 'http://127.0.0.1:1',
    ...TEST_BASIC_AUTH_ENV,
    ...overrides,
  };
  return {
    get: (key: string) => base[key],
  } as unknown as ConfigService<Env, true>;
}

function httpContext(
  headers: Record<string, string | string[] | undefined>,
  url = '/api/languages',
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ url, headers }) }),
  } as unknown as ExecutionContext;
}

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
