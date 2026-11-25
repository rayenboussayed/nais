import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { SetMetadata } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/internal';
import { SKIP_BASIC_AUTH_KEY } from 'nest-basic-auth';
import { describe, expect, it } from 'vitest';

import type { Env } from '../environment.js';

import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from '../../test/auth.js';
import { SESSION_COOKIE_NAME, signSession } from '../modules/auth/session.js';
import { HttpAuthGuard } from './auth.guard.js';

class ProtectedController {
  route(): void {}
}

@SetMetadata(SKIP_BASIC_AUTH_KEY, true)
class PublicController {
  check(): void {}

  @SetMetadata(SKIP_BASIC_AUTH_KEY, false)
  protectedRoute(): void {}

  route(): void {}
}

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
    // eslint-disable-next-line security/detect-object-injection -- test stub: config keys are compile-time constants
    get: (key: string) => base[key],
  } as unknown as ConfigService<Env, true>;
}

/**
 * Builds an HTTP execution context with metadata targets for the auth guard.
 * @param headers - the request headers
 * @param url - the request path
 * @param controller - the controller class used for skip metadata
 * @param handler - the handler function used for skip metadata
 * @returns the execution context double
 */
function httpContext(
  headers: Record<string, string | string[] | undefined>,
  url = '/api/languages',
  controller = ProtectedController,
  handler: () => void = ProtectedController.prototype.route,
) {
  const request = { headers, url };
  const reply = { header: () => undefined };
  return new ExecutionContextHost([request, reply], controller, handler);
}

/**
 * Builds an ExecutionContext for a websocket context.
 * @returns the context double
 */
function wsContext() {
  return { getType: () => 'ws' } as unknown as ExecutionContext;
}

describe('HttpAuthGuard', () => {
  it('passes routes marked with SkipBasicAuth without credentials', async () => {
    const guard = new HttpAuthGuard(configStub());
    const publicContext = httpContext(
      {},
      '/api/health',
      PublicController,
      PublicController.prototype.check,
    );
    await expect(guard.canActivate(publicContext)).resolves.toBe(true);
  });

  it('protects decorated routes when the handler opts back in', async () => {
    const guard = new HttpAuthGuard(configStub());
    const context = httpContext(
      {},
      '/api/health/foo',
      PublicController,
      PublicController.prototype.protectedRoute,
    );
    await expect(guard.canActivate(context)).rejects.toThrow('Unauthorized');
  });

  it('rejects unauthenticated requests to protected routes', async () => {
    const guard = new HttpAuthGuard(configStub());
    await expect(guard.canActivate(httpContext({}))).rejects.toThrow('Unauthorized');
    await expect(guard.canActivate(httpContext({}, '/api/health'))).rejects.toThrow('Unauthorized');
    await expect(guard.canActivate(httpContext({}, '/api/auth/login'))).rejects.toThrow(
      'Unauthorized',
    );
    await expect(guard.canActivate(httpContext({}, '/api/health/foo'))).rejects.toThrow(
      'Unauthorized',
    );
    await expect(guard.canActivate(httpContext({}, '/api/auth/login/extra'))).rejects.toThrow(
      'Unauthorized',
    );
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

  it('ignores the x-auth credential headers', async () => {
    const guard = new HttpAuthGuard(configStub());
    await expect(
      guard.canActivate(httpContext({ 'x-auth-name': 'admin', 'x-auth-pass': 'admin-password' })),
    ).rejects.toThrow('Unauthorized');
  });

  it('passes websocket contexts through without credentials', async () => {
    const guard = new HttpAuthGuard(configStub());
    await expect(guard.canActivate(wsContext())).resolves.toBe(true);
  });
});
